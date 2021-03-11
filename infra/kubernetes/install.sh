{{#pulumi_local_login}}
pulumi login --local
{{/pulumi_local_login}}
{{^pulumi_local_login}}
pulumi login
{{/pulumi_local_login}}
pulumi stack init {{pulumi_stack_name.Value}}
pulumi stack select {{pulumi_stack_name.Value}}
npm install