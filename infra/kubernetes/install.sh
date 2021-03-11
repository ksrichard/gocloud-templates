{{#pulumi_local_login.Value}}
pulumi login --local
{{/pulumi_local_login.Value}}
{{^pulumi_local_login.Value}}
pulumi login
{{/pulumi_local_login.Value}}
pulumi stack init {{pulumi_stack_name.Value}}
pulumi stack select {{pulumi_stack_name.Value}}
npm install