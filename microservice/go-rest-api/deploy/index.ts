import * as kx from "@pulumi/kubernetesx";
import * as docker from "@pulumi/docker";
import * as pulumi from "@pulumi/pulumi";
import {Ingress} from "@pulumi/kubernetes/networking/v1beta1";
import {HorizontalPodAutoscaler} from "@pulumi/kubernetes/autoscaling/v2beta2";

// infra stack info
const infraStack = new pulumi.StackReference(`ksrichard/infra/${pulumi.getStack()}`);
const imagePullSecretName = infraStack.requireOutput("imagePullSecretName").apply(v => `${v}`);
const appsNamespaceName = infraStack.requireOutput("appsNamespaceName").apply(v => `${v}`);
const repoName = infraStack.requireOutput("repoName").apply(v => `${v}`);
const registryUrl = infraStack.requireOutput("registryUrl").apply(v => `${v}`);
const registryUsername = infraStack.requireOutput("registryUsername").apply(v => `${v}`);
const registryPassword = infraStack.requireOutput("registryPassword").apply(v => `${v}`);
const host = infraStack.requireOutput("host").apply(v => `${v}`);

// config
const config = new pulumi.Config("app");
const serviceName = config.require("serviceName");
const labels = {app: serviceName};
const imageName = config.require("imageName");
const servicePath = config.require("servicePath");
const qraphQlQueryPath = config.require("qraphQlQueryPath");
const servicePort = config.requireNumber("servicePort");
const useLocalRepo = config.requireBoolean("useLocalRepo");
const autoScalingEnabled = config.requireBoolean("autoScalingEnabled");
const serviceHealthCheckPath = config.require("serviceHealthCheckPath");
const createIngress = config.requireBoolean("createIngress");

// DB config
const dbName = config.require("dbName");
const dbServiceName = infraStack.requireOutput("dbServiceName").apply(v => `${v}`);
const dbPort = infraStack.requireOutput("dbPort").apply(v => `${v}`);
const dbUsername = infraStack.requireOutput("dbUsername").apply(v => `${v}`);
const dbPassword = infraStack.requireOutput("dbPassword").apply(v => `${v}`);
let dsn = pulumi.interpolate `${dbUsername}:${dbPassword}@tcp(${dbServiceName}:${dbPort})/${dbName}?charset=utf8mb4&parseTime=True&loc=Local`;

// for local testing
let imagePullPolicy = useLocalRepo ? "Never" : "Always";

const dockerImage = new docker.Image(imageName, {
    imageName: pulumi.interpolate `${registryUrl}/${repoName}/${imageName}:latest`,
    build: "../",
    skipPush: useLocalRepo,
    localImageName: `${imageName}:latest`,
    registry: {
        server: registryUrl,
        username:  registryUsername,
        password: registryPassword,
    }
});

let pb;
if (useLocalRepo) {
    pb = new kx.PodBuilder({
        containers: [{
            name: serviceName,
            image: `${imageName}:latest`,
            ports: {http: servicePort},
            imagePullPolicy: imagePullPolicy,
            resources: {
                limits: {
                    cpu: config.require("cpuLimit"),
                    memory: config.require("memoryLimit"),
                }
            },
            readinessProbe: {
                initialDelaySeconds: 5,
                periodSeconds: 5,
                successThreshold: 1,
                failureThreshold: 5,
                httpGet: {
                    path: serviceHealthCheckPath,
                    port: servicePort,
                }
            },
            livenessProbe: {
                httpGet: {
                    path: serviceHealthCheckPath,
                    port: servicePort,
                }
            },
            env: [
                {
                    name: "PORT",
                    value: servicePort.toString()
                },
                {
                    name: "ROOT_PATH",
                    value: servicePath
                },
                {
                    name: "QUERY_PATH",
                    value: qraphQlQueryPath
                },
                {
                    name: "HEALTH_CHECK_PATH",
                    value: serviceHealthCheckPath
                },
                {
                    name: "GORM_MYSQL_DSN",
                    value: dsn
                }
            ],
        }]
    });
} else {
    pb = new kx.PodBuilder({
        imagePullSecrets: [{name: imagePullSecretName}],
        containers: [{
            name: serviceName,
            image: dockerImage.baseImageName,
            ports: {http: servicePort},
            imagePullPolicy: imagePullPolicy,
            resources: {
                limits: {
                    cpu: config.require("cpuLimit"),
                    memory: config.require("memoryLimit"),
                }
            },
            readinessProbe: {
                initialDelaySeconds: 10,
                periodSeconds: 5,
                successThreshold: 1,
                failureThreshold: 5,
                httpGet: {
                    path: serviceHealthCheckPath,
                    port: servicePort,
                }
            },
            livenessProbe: {
                httpGet: {
                    path: serviceHealthCheckPath,
                    port: servicePort,
                }
            },
            env: [
                {
                    name: "PORT",
                    value: servicePort.toString(),
                },
                {
                    name: "ROOT_PATH",
                    value: servicePath,
                },
                {
                    name: "QUERY_PATH",
                    value: qraphQlQueryPath
                },
                {
                    name: "HEALTH_CHECK_PATH",
                    value: serviceHealthCheckPath
                },
                {
                    name: "GORM_MYSQL_DSN",
                    value: dsn
                }
            ],
        }]
    });
}

// deployment
const deployment = new kx.Deployment(serviceName, {
    metadata: {
      labels: labels,
      namespace: appsNamespaceName,
    },
    spec: pb.asDeploymentSpec({
        replicas: config.requireNumber("autoScalingMinReplicas")
    })
}, {dependsOn: dockerImage});

// HPA
if (autoScalingEnabled) {
    const autoScaler = new HorizontalPodAutoscaler(serviceName, {
        metadata: {
            namespace: appsNamespaceName,
        },
            spec: {
                minReplicas: config.requireNumber("autoScalingMinReplicas"),
                maxReplicas: config.requireNumber("autoScalingMaxReplicas"),
                scaleTargetRef: {
                    name: deployment.metadata.name,
                    apiVersion: "apps/v1",
                    kind: "Deployment"
                },
                metrics: [
                    {
                        type: "Resource",
                        resource: {
                            name: "cpu",
                            target: {
                                type: "Utilization",
                                averageUtilization: config.requireNumber("autoScalingCpuMaxPercentage"),
                            }
                        }
                    },
                    {
                        type: "Resource",
                        resource: {
                            name: "memory",
                            target: {
                                type: "Utilization",
                                averageUtilization: config.requireNumber("autoScalingMemoryMaxPercentage"),
                            }
                        }
                    }
                ]
            }
        },
        {dependsOn: deployment});
}

// service
const service = deployment.createService({
    selector: labels,
});
export const serviceUrl = pulumi.interpolate `http://${service.metadata.name.apply(v => `${v}`)}:${servicePort}${qraphQlQueryPath}`;

// ingress
if (createIngress) {
    const ingress = new Ingress(serviceName,
        {
            metadata: {
                labels: labels,
                namespace: appsNamespaceName,
                annotations: {"kubernetes.io/ingress.class": "nginx"},
            },
            spec: {
                rules: [
                    {
                        host: host,
                        http: {
                            paths: [
                                {
                                    path: servicePath,
                                    backend: {
                                        serviceName: service.metadata.name,
                                        servicePort: servicePort,
                                    }
                                },
                            ],
                        },
                    }
                ]
            }
        },
        {dependsOn: service}
    );
}