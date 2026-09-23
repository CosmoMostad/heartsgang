# Deploying heartsgang.net

Every push to `main` runs the tests and then deploys, once an AWS role is configured. Until then the deploy job is skipped with a notice.

## One-time setup

**1. Create the deploy role and DNS zone.** Open the AWS console, click the `>_` CloudShell icon in the top bar, and paste the contents of [`setup-aws.sh`](setup-aws.sh). To get budget alert emails, run it as `EMAIL=you@example.com bash setup-aws.sh` instead.

It prints two things:

```
ROLE: arn:aws:iam::123456789012:role/heartsgang-deploy
NAMESERVERS (only needed if you bought the domain outside Route 53):
ns-1.awsdns-01.org  ns-2.awsdns-02.co.uk  ns-3.awsdns-03.com  ns-4.awsdns-04.net
```

The role can only be used by GitHub Actions runs on the `main` branch of `CosmoMostad/heartsgang`. Run the script inside the AWS account dedicated to Hearts Gang, not a shared one: the role has full admin over whatever account it lives in.

**2. Point the domain at AWS.** Skip this if you bought heartsgang.net through Route 53. Otherwise, at your registrar (GoDaddy, Namecheap, Squarespace, Porkbun…), replace the domain's nameservers with the four printed above. Cloudflare Registrar does not allow this; keep DNS there and add an `A` record for `heartsgang.net` and `www` pointing at the server IP the deploy prints.

**3. Turn deploys on.** Put the role ARN into [`config.json`](config.json) as `awsRoleArn` and push to `main`. Alternatively, set a repository variable named `AWS_ROLE_ARN` in GitHub settings.

## What a deploy does

1. Tests and builds everything, including browser tests.
2. Creates or updates the AWS resources with CDK: a VPC, one t4g.micro server, an Elastic IP, a private release bucket, `A` records for `heartsgang.net` and `www`, and an auto-recover alarm.
3. Uploads the release and installs it on the server through Systems Manager (no SSH).
4. Waits for the game server's health check on the machine, then checks `https://heartsgang.net/health`.

On the very first deploy the server takes a few minutes to boot and install Node and Caddy. Caddy gets the HTTPS certificate on its own once DNS points at the server. If DNS is still switching over, the last step warns but the deploy succeeds; the site comes up as soon as DNS resolves.

Games survive deploys: the server saves every table to disk on shutdown and restores it on start.

## Useful commands

```bash
# Server logs (from CloudShell)
aws ssm start-session --target <InstanceId>
sudo journalctl -u heartsgang -f
sudo journalctl -u caddy -f

# Roll back to an earlier build
sudo heartsgang-deploy releases/<git sha>.tgz
```
