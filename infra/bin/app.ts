import * as cdk from 'aws-cdk-lib';
import { HeartsGangStack } from '../lib/stack';

const app = new cdk.App();
const domain = app.node.tryGetContext('domain') ?? 'heartsgang.net';
const zoneId = app.node.tryGetContext('zoneId');
if (!zoneId) throw new Error('Pass the Route 53 hosted zone id: cdk deploy -c zoneId=Z0123456789');

new HeartsGangStack(app, 'HeartsGang', {
  domain,
  zoneId,
  // Account-agnostic: deploys to whichever account and region the deploy role signs in to (us-east-1 in CI).
  description: 'heartsgang.net: one small game server with automatic HTTPS',
});
