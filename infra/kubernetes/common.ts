import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export function createImagePullSecret(secretName: string,
                                      username: string,
                                      password: string,
                                      registry : string): k8s.core.v1.Secret {

    // Put the username password into dockerconfigjson format.
    let base64JsonEncodedCredentials : pulumi.Output<string> =
        pulumi.all([username, password, registry])
            .apply(([username, password, registry]) => {
                const base64Credentials = Buffer.from(username + ':' + password).toString('base64');
                const json =  `{"auths":{"${registry}":{"username":"${username}","password":"${password}","email":"${username}","auth":"${base64Credentials}"}}}`;
                return Buffer.from(json).toString('base64');
            });

    return new k8s.core.v1.Secret(secretName, {
        metadata: {
            name: secretName,
        },
        type: 'kubernetes.io/dockerconfigjson',
        data: {
            ".dockerconfigjson": base64JsonEncodedCredentials,
        },
    })
}