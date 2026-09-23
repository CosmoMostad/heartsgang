import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { bootScript } from './userdata';

export interface HeartsGangProps extends cdk.StackProps {
  domain: string;
  zoneId: string;
  instanceType?: string;
}

/**
 * Everything heartsgang.net needs: one small ARM server running the game and
 * Caddy (HTTPS), a private bucket for releases, DNS records, and auto-recovery.
 */
export class HeartsGangStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HeartsGangProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const sg = new ec2.SecurityGroup(this, 'WebAccess', { vpc, description: 'HTTP and HTTPS to the game server', allowAllOutbound: true });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP (redirects and certificate checks)');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    const releases = new s3.Bucket(this, 'Releases', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ prefix: 'releases/', expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const role = new iam.Role(this, 'ServerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    releases.grantRead(role);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(...bootScript({ bucket: releases.bucketName, domain: props.domain, region: this.region }));

    const server = new ec2.Instance(this, 'Server', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType ?? 't4g.micro'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      securityGroup: sg,
      role,
      userData,
      requireImdsv2: true,
      blockDevices: [{ deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(10, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }) }],
    });

    const ip = new ec2.CfnEIP(this, 'PublicIp', { domain: 'vpc', instanceId: server.instanceId });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: props.zoneId, zoneName: props.domain });
    new route53.ARecord(this, 'ApexRecord', { zone, target: route53.RecordTarget.fromIpAddresses(ip.ref), ttl: cdk.Duration.minutes(5) });
    new route53.ARecord(this, 'WwwRecord', { zone, recordName: 'www', target: route53.RecordTarget.fromIpAddresses(ip.ref), ttl: cdk.Duration.minutes(5) });

    // If the underlying hardware fails, AWS moves the server to healthy hardware with the same IP and disk.
    const failed = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'StatusCheckFailed_System',
      dimensionsMap: { InstanceId: server.instanceId },
      period: cdk.Duration.minutes(1),
      statistic: 'Maximum',
    });
    new cloudwatch.Alarm(this, 'AutoRecover', {
      metric: failed,
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Recover the Hearts Gang server if its host fails',
    }).addAlarmAction(new cwActions.Ec2Action(cwActions.Ec2InstanceAction.RECOVER));

    new cdk.CfnOutput(this, 'InstanceId', { value: server.instanceId });
    new cdk.CfnOutput(this, 'ReleaseBucket', { value: releases.bucketName });
    new cdk.CfnOutput(this, 'PublicIpAddress', { value: ip.ref });
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${props.domain}` });
  }
}
