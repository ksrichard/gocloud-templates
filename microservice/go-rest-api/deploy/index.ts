import * as kx from "@pulumi/kubernetesx";
import * as docker from "@pulumi/docker";
import {Namespace} from "@pulumi/kubernetes/core/v1";
import * as pulumi from "@pulumi/pulumi";
import {Ingress} from "@pulumi/kubernetes/networking/v1beta1";
import {HorizontalPodAutoscaler} from "@pulumi/kubernetes/autoscaling/v2beta2";

const config = new pulumi.Config("app");

{{#host.IsPulumiOutput}}
const host = new pulumi.StackReference(`{{host.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{host.PulumiOutputVar}}").apply(v => `${v}`);
{{/host.IsPulumiOutput}}
{{^host.IsPulumiOutput}}
export const host = config.require("host");
{{/host.IsPulumiOutput}}

{{#registry_url.IsPulumiOutput}}
const registryUrl = new pulumi.StackReference(`{{registry_url.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{registry_url.PulumiOutputVar}}").apply(v => `${v}`);
{{/registry_url.IsPulumiOutput}}
{{^registry_url.IsPulumiOutput}}
export const registryUrl = config.require("registryUrl");
{{/registry_url.IsPulumiOutput}}

{{#registry_username.IsPulumiOutput}}
const registryUsername = new pulumi.StackReference(`{{registry_username.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{registry_username.PulumiOutputVar}}").apply(v => `${v}`);
{{/registry_username.IsPulumiOutput}}
{{^registry_username.IsPulumiOutput}}
export const registryUsername = config.require("registryUsername");
{{/registry_username.IsPulumiOutput}}

{{#registry_password.IsPulumiOutput}}
const registryUsername = new pulumi.StackReference(`{{registry_password.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{registry_password.PulumiOutputVar}}").apply(v => `${v}`);
{{/registry_password.IsPulumiOutput}}
{{^registry_password.IsPulumiOutput}}
export const registryPassword = config.require("registryPassword");
{{/registry_password.IsPulumiOutput}}

{{#k8s_namespace.IsPulumiOutput}}
const appsNamespaceName = new pulumi.StackReference(`{{k8s_namespace.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{k8s_namespace.PulumiOutputVar}}").apply(v => `${v}`);
{{/k8s_namespace.IsPulumiOutput}}
{{^k8s_namespace.IsPulumiOutput}}
export const appsNamespaceName = config.require("namespace");
{{/k8s_namespace.IsPulumiOutput}}

{{#repo_name.IsPulumiOutput}}
const repoName = new pulumi.StackReference(`{{repo_name.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{repo_name.PulumiOutputVar}}").apply(v => `${v}`);
{{/repo_name.IsPulumiOutput}}
{{^repo_name.IsPulumiOutput}}
export const repoName = config.require("repo_name");
{{/repo_name.IsPulumiOutput}}


// infra stack info
const imagePullSecretName = infraStack.requireOutput("imagePullSecretName").apply(v => `${v}`);


// config
const serviceName = config.require("serviceName");
const labels = {app: serviceName};
const imageName = config.require("imageName");
const servicePath = config.require("servicePath");
const servicePort = config.requireNumber("servicePort");
const useLocalRepo = config.requireBoolean("useLocalRepo");
const autoScalingEnabled = config.requireBoolean("autoScalingEnabled");
const serviceHealthCheckPath = config.require("serviceHealthCheckPath");
const createIngress = config.requireBoolean("createIngress");

// DB config
const dbName = config.require("dbName");
const dbUrl = infraStack.requireOutput("dbServiceName").apply(v => `${v}`);
const dbPort = infraStack.requireOutput("dbPort").apply(v => `${v}`);
const dbUsername = infraStack.requireOutput("dbUsername").apply(v => `${v}`);
const dbPassword = infraStack.requireOutput("dbPassword").apply(v => `${v}`);
let dsn = pulumi.interpolate `${dbUsername}:${dbPassword}@tcp(${dbUrl}:${dbPort})/${dbName}?charset=utf8mb4&parseTime=True&loc=Local`;

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
export const serviceUrl = pulumi.interpolate `http://${service.metadata.name.apply(v => `${v}`)}:${servicePort}`;

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