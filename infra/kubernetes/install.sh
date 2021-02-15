{{#pulumi_local_login}}
pulumi login --local
{{/pulumi_local_login}}
{{^pulumi_local_login}}
pulumi login
{{/pulumi_local_login}}
pulumi stack init {{stack}}
pulumi stack select {{stack}}
npm install