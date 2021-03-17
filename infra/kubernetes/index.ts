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

export const imagePullSecretName: string = "image-pull-secret";
const secret = common.createImagePullSecret(imagePullSecretName, registryUsername, registryPassword, registryUrl);
{{/create_image_pull_secret.Value}}

const controlPlaneNs = new Namespace("control");
export const controlPlaneNamespaceName = controlPlaneNs.metadata.name;

let credentials = null;

const appsNs = new Namespace("apps");
export const appsNamespaceName = appsNs.metadata.name;

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

{{#db_url.IsPulumiOutput}}
const dbUrl = new pulumi.StackReference(`{{db_url.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{db_url.PulumiOutputVar}}").apply(v => `${v}`);
{{/db_url.IsPulumiOutput}}
{{^db_url.IsPulumiOutput}}
export const dbUrl = pulumi.interpolate `${config.require("dbUrl")}`;
{{/db_url.IsPulumiOutput}}

{{#db_username.IsPulumiOutput}}
const dbUsername = new pulumi.StackReference(`{{db_username.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{db_username.PulumiOutputVar}}").apply(v => `${v}`);
{{/db_username.IsPulumiOutput}}
{{^db_username.IsPulumiOutput}}
export const dbUsername = config.require("dbUsername");
{{/db_username.IsPulumiOutput}}

{{#db_password.IsPulumiOutput}}
const dbPassword = new pulumi.StackReference(`{{db_password.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{db_password.PulumiOutputVar}}").apply(v => `${v}`);
{{/db_password.IsPulumiOutput}}
{{^db_password.IsPulumiOutput}}
export const dbPassword = config.require("dbPassword");
{{/db_password.IsPulumiOutput}}

{{#db_name.IsPulumiOutput}}
const dbName = new pulumi.StackReference(`{{db_name.PulumiStackReference}}/${pulumi.getStack()}`).requireOutput("{{db_name.PulumiOutputVar}}").apply(v => `${v}`);
{{/db_name.IsPulumiOutput}}
{{^db_name.IsPulumiOutput}}
export const dbName = config.require("dbName");
{{/db_name.IsPulumiOutput}}

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
        CREATE DATABASE ${dbName};
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





