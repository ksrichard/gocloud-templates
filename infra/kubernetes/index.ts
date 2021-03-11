import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";
import * as common from "./common";
import * as pulumi from "@pulumi/pulumi";
import {Namespace} from "@pulumi/kubernetes/core/v1";
import {Htpasswd, HtpasswdAlgorithm} from 'pulumi-htpasswd';

const config = new pulumi.Config("app");

{{#host.IsPulumiOutput}}
const host = new pulumi.StackReference(`{{host.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{host.PulumiOutputVar}}").apply(v => `${v}`);
{{/host.IsPulumiOutput}}

{{^host.IsPulumiOutput}}
export const host = config.require("host");
{{/host.IsPulumiOutput}}

const useVPN = config.requireBoolean("useVPN");

{{#create_image_pull_secret.Value}}
export const registryUrl = config.require("registryUrl");
export const registryUsername = config.require("registryUsername");
export const registryPassword = config.require("registryPassword");
export const imagePullSecretName: string = "image-pull-secret";
const secret = common.createImagePullSecret(imagePullSecretName, registryUsername, registryPassword, registryUrl);
{{/create_image_pull_secret.Value}}

const controlPlaneNs = new Namespace("control");
export const controlPlaneNamespaceName = controlPlaneNs.metadata.name;

const appsNs = new Namespace("apps");
export const appsNamespaceName = appsNs.metadata.name;

let credentials = null;

if (useVPN) {
    const openvpn = new k8s.helm.v3.Chart("vpn",
        {
            namespace: controlPlaneNamespaceName,
            chart: "openvpn",
            version: "4.2.3",
            fetchOpts: {repo: "https://charts.helm.sh/stable"},
            values: {
                service: {
                    externalPort: 4444,
                }
            }
        },
    );
}

let ingressAnnotations: {[k: string]: any} = {
    "kubernetes.io/ingress.class": "nginx",
    "nginx.ingress.kubernetes.io/enable-global-auth": "false",
};

const nginx = new k8s.helm.v3.Chart("nginx",
    {
        namespace: controlPlaneNamespaceName,
        chart: "nginx-ingress",
        version: "1.24.4",
        fetchOpts: {repo: "https://charts.helm.sh/stable"},
        values: {controller: {publishService: {enabled: true}}},
        },
);

const metricsServer = new k8s.helm.v3.Chart("metrics-server",
    {
        namespace: controlPlaneNamespaceName,
        chart: "metrics-server",
        version: "2.11.2",
        fetchOpts: {repo: "https://charts.helm.sh/stable"},
        values: {
            args: [
                "/metrics-server",
                "--v=2",
                "--kubelet-preferred-address-types=InternalIP",
                "--kubelet-insecure-tls=true",
            ]
        }
    },
);

const elasticSearch = new k8s.helm.v3.Chart("elasticsearch",
    {
        namespace: controlPlaneNamespaceName,
        chart: "elasticsearch",
        version: "7.9.2",
        fetchOpts: {repo: "https://helm.elastic.co"},
        values: {
            replicas: 1,
        }
    },
);

const filebeat = new k8s.helm.v3.Chart("filebeat",
    {
        namespace: controlPlaneNamespaceName,
        chart: "filebeat",
        version: "7.9.2",
        fetchOpts: {repo: "https://helm.elastic.co"},
    },
    {dependsOn: [elasticSearch]}
);

const kibana = new k8s.helm.v3.Chart("kibana",
    {
        namespace: controlPlaneNamespaceName,
        chart: "kibana",
        version: "7.9.2",
        fetchOpts: {repo: "https://helm.elastic.co"},
        values: {
            replicas: 1,
            elasticsearchHosts: "http://elasticsearch-master:9200",
            kibanaConfig: {
                "kibana.yml": `
                server.basePath: "/kibana"
                server.rewriteBasePath: true
                `
            },
            lifecycle: {
                postStart: {
                    exec: {
                        command: [
                            "bash",
                            "-c",
                            `#!/bin/bash
                              # Import a dashboard
                              KB_URL=http://localhost:5601/kibana/app/kibana
                              while [[ "$(curl -s -o /dev/null -w '%{http_code}\\n' -L $KB_URL)" != "200" ]]; do sleep 1; done
                              curl  -X POST -v http://localhost:5601/kibana/api/saved_objects/index-pattern/default_filebeat -H 'kbn-xsrf: true' -H 'Content-Type: application/json' -d '{"attributes": {"title": "'filebeat-*'"}}'
                            `
                        ]
                    }
                }
            },
            healthCheckPath: "/kibana/app/kibana",
            ingress: {
                enabled: !useVPN,
                path: "/kibana",
                hosts: [
                    host
                ],
                annotations: ingressAnnotations
            }
        }
    },
    {dependsOn: [elasticSearch]}
);

{{#use_db.Value}}
// DB
const selfHostedDb = config.requireBoolean("selfHostedDb");
export const dbUrl = pulumi.interpolate `${config.require("dbUrl")}`;
export const dbUsername = config.require("dbUsername");
export const dbPassword = config.require("dbPassword");
export const dbPort = config.requireNumber("dbPort");
let dbHost = dbUrl;

if (selfHostedDb) {
    // init DB script configmap
    const initDbScriptsConfigMap = new kx.ConfigMap("init-db-scripts", {
        metadata: {
            namespace: controlPlaneNamespaceName,
        },
        data: {
            "init.sql": pulumi.interpolate `
        CREATE DATABASE {{db_name}};
        GRANT ALL PRIVILEGES ON user_service.* TO '${dbUsername}'@'%';
        FLUSH PRIVILEGES;
        `,
        }
    });

    // DB
    const database = new k8s.helm.v3.Chart("db",
        {
            namespace: controlPlaneNamespaceName,
            chart: "mysql",
            version: "6.14.11",
            fetchOpts: {repo: "https://charts.bitnami.com/bitnami"},
            values: {
                db: {
                    user: dbUsername,
                    password: dbPassword,
                },
                initdbScriptsConfigMap: initDbScriptsConfigMap.metadata.name,
                service: {
                    port: dbPort,
                },
            }
        },
    );

    dbHost = pulumi.interpolate `db-mysql.${controlPlaneNamespaceName}.svc.cluster.local`;
}

const appsDbService = new k8s.core.v1.Service("db-mysql", {
    metadata: {
        namespace: appsNamespaceName,
    },
    spec: {
        type: "ExternalName",
        externalName: dbHost,
        ports: [
            {
                port: dbPort
            }
        ]
    }
});

export const dbServiceName = appsDbService.metadata.name;
{{/use_db.Value}}





