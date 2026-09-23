#!/bin/bash
# One-time AWS setup for heartsgang.net. Paste into AWS CloudShell (the >_ icon in the console top bar).
# Creates: a GitHub sign-in role that only the CosmoMostad/heartsgang repo can use, the Route 53 zone
# for the domain (or reuses the one Route 53 made when you bought it), and a $20/month budget alert.
set -uo pipefail
DOMAIN="heartsgang.net"
EMAIL="${EMAIL:-}"          # optional: EMAIL=you@example.com bash setup-aws.sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null 2>&1 || true

cat > /tmp/heartsgang-trust.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Federated":"arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
  "StringLike":{"token.actions.githubusercontent.com:sub":["repo:CosmoMostad/heartsgang:*","repo:cosmomostad/heartsgang:*"]}}}]}
JSON
aws iam create-role --role-name heartsgang-deploy --assume-role-policy-document file:///tmp/heartsgang-trust.json >/dev/null 2>&1 \
  || aws iam update-assume-role-policy --role-name heartsgang-deploy --policy-document file:///tmp/heartsgang-trust.json
aws iam attach-role-policy --role-name heartsgang-deploy --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --query "HostedZones[?Name=='$DOMAIN.'].Id | [0]" --output text)
if [ -z "$ZONE" ] || [ "$ZONE" = "None" ]; then
  ZONE=$(aws route53 create-hosted-zone --name "$DOMAIN" --caller-reference "hg-$(date +%s)" --query HostedZone.Id --output text)
fi
ZONE=${ZONE##*/}

if [ -n "$EMAIL" ]; then
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget '{"BudgetName":"heartsgang","BudgetLimit":{"Amount":"20","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
    --notifications-with-subscribers "[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$EMAIL\"}]}]" 2>/dev/null || true
fi

echo
echo "ROLE: arn:aws:iam::${ACCOUNT}:role/heartsgang-deploy"
echo "NAMESERVERS (only needed if you bought the domain outside Route 53):"
aws route53 get-hosted-zone --id "$ZONE" --query DelegationSet.NameServers --output text
