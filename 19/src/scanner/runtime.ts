import { RuntimeRisk, Severity, ImageConfig, ContainerConfig, FileInfo } from '../types';
import { SENSITIVE_PATHS, DANGEROUS_PORTS } from '../constants';

export interface RuntimeCheckOptions {
  checkPrivileged?: boolean;
  checkPorts?: boolean;
  checkMounts?: boolean;
  checkUser?: boolean;
  checkEnv?: boolean;
  checkHealthcheck?: boolean;
}

export function analyzeRuntimeRisks(
  config: ImageConfig,
  files: FileInfo[],
  options: RuntimeCheckOptions = {}
): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];
  const containerConfig = config.config || {};

  const defaultOptions: Required<RuntimeCheckOptions> = {
    checkPrivileged: true,
    checkPorts: true,
    checkMounts: true,
    checkUser: true,
    checkEnv: true,
    checkHealthcheck: true,
  };

  const opts = { ...defaultOptions, ...options };

  if (opts.checkUser) {
    risks.push(...checkUserConfig(containerConfig));
  }

  if (opts.checkPorts) {
    risks.push(...checkExposedPorts(containerConfig));
  }

  if (opts.checkMounts) {
    risks.push(...checkVolumes(containerConfig, files));
  }

  if (opts.checkEnv) {
    risks.push(...checkEnvironment(containerConfig));
  }

  if (opts.checkHealthcheck) {
    risks.push(...checkHealthcheck(containerConfig));
  }

  risks.push(...checkSensitiveFiles(files));
  risks.push(...checkSUIDFiles(files));
  risks.push(...checkShell(containerConfig));
  risks.push(...checkArchitecture(config));

  return sortRisksBySeverity(risks);
}

function checkUserConfig(config: ContainerConfig): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];
  const user = config.User;

  if (!user || user === 'root' || user === '0' || user === 'root:root' || user === '0:0') {
    risks.push({
      id: 'RT-001',
      severity: 'High',
      category: 'User Configuration',
      title: '容器以 root 用户运行',
      description: '容器配置为以 root 用户运行，可能导致权限提升攻击。攻击者如果成功入侵容器，将获得主机的 root 权限。',
      evidence: `USER directive: ${user || 'not set (defaults to root)'}`,
      remediation: '在 Dockerfile 中添加非 root 用户：RUN useradd -m appuser && USER appuser',
    });
  }

  return risks;
}

function checkExposedPorts(config: ContainerConfig): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];
  const exposedPorts = config.ExposedPorts || {};

  for (const portSpec of Object.keys(exposedPorts)) {
    const portNum = parseInt(portSpec.split('/')[0], 10);

    if (DANGEROUS_PORTS.includes(portNum)) {
      const severity = getPortSeverity(portNum);
      risks.push({
        id: `RT-002-${portNum}`,
        severity,
        category: 'Network',
        title: `暴露了危险端口 ${portNum}`,
        description: `端口 ${portNum} 通常用于敏感服务，暴露在容器中可能增加攻击面。`,
        evidence: `EXPOSE ${portSpec}`,
        remediation: `考虑使用网络隔离或仅在需要时暴露端口 ${portNum}。确保服务有适当的身份验证。`,
      });
    }

    if (portNum < 1024) {
      risks.push({
        id: `RT-003-${portNum}`,
        severity: 'Medium',
        category: 'Network',
        title: `暴露了特权端口 ${portNum}`,
        description: `端口 ${portNum} 是特权端口（<1024），需要 root 权限才能绑定。这可能迫使容器以 root 运行。`,
        evidence: `EXPOSE ${portSpec}`,
        remediation: '考虑使用 >1024 的非特权端口，并在运行时通过端口映射转发。',
      });
    }
  }

  return risks;
}

function getPortSeverity(port: number): Severity {
  const criticalPorts = [22, 2375, 2376, 4243];
  const highPorts = [3306, 5432, 6379, 27017, 10250, 10255];

  if (criticalPorts.includes(port)) return 'Critical';
  if (highPorts.includes(port)) return 'High';
  return 'Medium';
}

function checkVolumes(config: ContainerConfig, files: FileInfo[]): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];
  const volumes = config.Volumes || {};

  for (const volumePath of Object.keys(volumes)) {
    for (const sensitivePath of SENSITIVE_PATHS) {
      if (volumePath === sensitivePath || volumePath.startsWith(sensitivePath + '/')) {
        risks.push({
          id: `RT-004-${volumePath.replace(/[\/.]/g, '-')}`,
          severity: 'Critical',
          category: 'Filesystem',
          title: `挂载敏感目录 ${volumePath}`,
          description: `容器配置为挂载敏感目录 ${volumePath}，这可能导致敏感信息泄露或主机文件系统被篡改。`,
          evidence: `VOLUME ${volumePath}`,
          remediation: '避免挂载敏感系统目录。如果必须挂载，使用只读模式并严格限制访问。',
        });
      }
    }

    if (volumePath === '/var/run/docker.sock') {
      risks.push({
        id: 'RT-005',
        severity: 'Critical',
        category: 'Filesystem',
        title: '挂载 Docker Socket',
        description: '容器挂载了 Docker socket，这等同于授予了容器对主机的完全 root 访问权限。攻击者可以通过这个 socket 控制整个 Docker 守护进程。',
        evidence: 'VOLUME /var/run/docker.sock',
        remediation: '不要挂载 Docker socket。如果需要 Docker API 访问，考虑使用 Docker-in-Docker 或专用的 API 代理。',
      });
    }
  }

  for (const file of files) {
    if (file.path === '/.dockerenv') continue;

    for (const sensitivePath of SENSITIVE_PATHS) {
      if (file.path === sensitivePath || file.path.startsWith(sensitivePath + '/')) {
        if (file.type === 'file' && file.mode & 0o004) {
          risks.push({
            id: `RT-006-${file.path.replace(/[\/.]/g, '-')}`,
            severity: 'Medium',
            category: 'Filesystem',
            title: `敏感文件可读: ${file.path}`,
            description: `敏感路径下的文件 ${file.path} 对其他用户可读，可能导致信息泄露。`,
            evidence: `File: ${file.path}, mode: ${file.mode.toString(8)}`,
            remediation: '收紧敏感文件的权限，确保不会被容器内的非授权用户读取。',
          });
        }
      }
    }
  }

  return risks;
}

function checkEnvironment(config: ContainerConfig): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];
  const env = config.Env || [];

  const secretPatterns = [
    /PASSWORD/i,
    /SECRET/i,
    /TOKEN/i,
    /KEY/i,
    /CREDENTIAL/i,
    /API_?KEY/i,
    /AWS_/i,
    /PRIVATE_?KEY/i,
  ];

  for (const envVar of env) {
    const [name, value] = envVar.split('=', 2);

    for (const pattern of secretPatterns) {
      if (pattern.test(name) && value && value.length > 0) {
        risks.push({
          id: `RT-007-${name}`,
          severity: 'High',
          category: 'Secrets',
          title: `环境变量中可能包含敏感信息: ${name}`,
          description: `环境变量 ${name} 的名称暗示它可能包含敏感信息（密码、密钥等）。将敏感信息硬编码在镜像中是不安全的。`,
          evidence: `ENV ${name}=${value.slice(0, 3)}***`,
          remediation: '不要在镜像中硬编码敏感信息。在运行时使用 Docker Secrets、Kubernetes Secrets 或环境变量注入。',
        });
        break;
      }
    }
  }

  return risks;
}

function checkHealthcheck(config: ContainerConfig): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];

  if (!config.Healthcheck) {
    risks.push({
      id: 'RT-008',
      severity: 'Low',
      category: 'Health',
      title: '缺少健康检查配置',
      description: '容器没有配置健康检查，这使得编排系统（如 Kubernetes、Docker Swarm）无法检测容器是否正常运行。',
      evidence: 'No HEALTHCHECK instruction found',
      remediation: '添加 HEALTHCHECK 指令来监控容器健康状态，例如：HEALTHCHECK CMD curl -f http://localhost/ || exit 1',
    });
  } else {
    const hc = config.Healthcheck;
    if (hc.Timeout && hc.Timeout > 30000000000) {
      risks.push({
        id: 'RT-009',
        severity: 'Low',
        category: 'Health',
        title: '健康检查超时时间过长',
        description: '健康检查的超时时间设置过长，可能导致问题检测延迟。',
        evidence: `HEALTHCHECK timeout: ${hc.Timeout}ns`,
        remediation: '考虑将健康检查超时时间设置为合理的值（如 5-30 秒）。',
      });
    }

    if (hc.Test && hc.Test.includes('CMD-SHELL')) {
      const testCmd = hc.Test.join(' ');
      if (/curl|\bwget\b|nc\b|netcat/.test(testCmd)) {
        risks.push({
          id: 'RT-010',
          severity: 'Medium',
          category: 'Health',
          title: '健康检查可能包含不必要的网络工具',
          description: '健康检查使用了 curl/wget 等网络工具，这些工具如果被攻击者利用，可能用于横向移动。',
          evidence: `HEALTHCHECK: ${testCmd}`,
          remediation: '考虑使用更简单的健康检查方法，或确保这些工具在生产环境中被移除或限制。',
        });
      }
    }
  }

  return risks;
}

function checkSensitiveFiles(files: FileInfo[]): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];

  const sshFiles = files.filter(
    (f) => f.path.startsWith('/root/.ssh/') || f.path.startsWith('/etc/ssh/')
  );

  for (const file of sshFiles) {
    if (file.path.endsWith('_rsa') || file.path.endsWith('_dsa') || file.path.endsWith('_ecdsa') || file.path.endsWith('id_ed25519')) {
      risks.push({
        id: `RT-011-${file.path.replace(/[\/.]/g, '-')}`,
        severity: 'Critical',
        category: 'Secrets',
        title: `镜像中包含 SSH 私钥: ${file.path}`,
        description: `SSH 私钥文件 ${file.path} 被构建到镜像中，这可能导致凭据泄露。攻击者可以使用这些密钥访问其他系统。`,
        evidence: `File exists: ${file.path}`,
        remediation: '从镜像中移除 SSH 私钥。使用 .dockerignore 或多阶段构建来避免将密钥打包进镜像。',
      });
    }
  }

  const dockerConfig = files.find((f) => f.path === '/root/.docker/config.json');
  if (dockerConfig) {
    risks.push({
      id: 'RT-012',
      severity: 'High',
      category: 'Secrets',
      title: '镜像中包含 Docker 配置文件',
      description: 'Docker config.json 可能包含 Docker registry 的认证凭据，泄露这些凭据可能导致未经授权的镜像仓库访问。',
      evidence: 'File exists: /root/.docker/config.json',
      remediation: '从镜像中移除 Docker 配置文件。确保在构建过程中不要复制认证文件。',
    });
  }

  const gitConfig = files.find((f) => f.path === '/root/.gitconfig');
  if (gitConfig) {
    risks.push({
      id: 'RT-013',
      severity: 'Medium',
      category: 'Secrets',
      title: '镜像中包含 Git 配置',
      description: '.gitconfig 文件可能包含 Git 仓库的认证令牌或用户凭据。',
      evidence: 'File exists: /root/.gitconfig',
      remediation: '从镜像中移除 Git 配置文件，或确保不包含敏感信息。',
    });
  }

  return risks;
}

function checkSUIDFiles(files: FileInfo[]): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];

  const dangerousSuidBins = [
    '/bin/chmod',
    '/bin/chown',
    '/bin/cp',
    '/bin/dd',
    '/bin/sh',
    '/bin/bash',
    '/usr/bin/su',
    '/usr/bin/sudo',
    '/usr/bin/find',
    '/usr/bin/vim',
    '/usr/bin/vi',
    '/usr/bin/emacs',
    '/usr/bin/python',
    '/usr/bin/python3',
    '/usr/bin/perl',
    '/usr/bin/ruby',
    '/usr/bin/nc',
    '/usr/bin/netcat',
    '/usr/sbin/chroot',
    '/usr/sbin/modprobe',
  ];

  for (const file of files) {
    if (file.type === 'file' && (file.mode & 0o4000)) {
      if (dangerousSuidBins.includes(file.path)) {
        risks.push({
          id: `RT-014-${file.path.replace(/[\/.]/g, '-')}`,
          severity: 'Critical',
          category: 'Privilege Escalation',
          title: `危险的 SUID 二进制文件: ${file.path}`,
          description: `${file.path} 被设置了 SUID 位，这可能被用于本地权限提升攻击。`,
          evidence: `File: ${file.path}, mode: ${file.mode.toString(8)}`,
          remediation: `移除 ${file.path} 的 SUID 位，或从镜像中删除不必要的二进制文件。`,
        });
      } else if (file.path.startsWith('/bin/') || file.path.startsWith('/usr/bin/')) {
        risks.push({
          id: `RT-015-${file.path.replace(/[\/.]/g, '-')}`,
          severity: 'Medium',
          category: 'Privilege Escalation',
          title: `SUID 二进制文件: ${file.path}`,
          description: `${file.path} 被设置了 SUID 位，可能存在潜在的权限提升风险。`,
          evidence: `File: ${file.path}, mode: ${file.mode.toString(8)}`,
          remediation: '审查所有 SUID 程序，移除不必要的 SUID 位。',
        });
      }
    }
  }

  return risks;
}

function checkShell(config: ContainerConfig): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];
  const shell = config.Shell;

  if (shell && shell.length > 0) {
    const shellStr = shell.join(' ');
    if (/bash|sh|zsh|ksh/.test(shellStr) && !shellStr.includes('-r')) {
      risks.push({
        id: 'RT-016',
        severity: 'Low',
        category: 'Shell',
        title: '默认 shell 可用于命令执行',
        description: `容器配置了交互式 shell (${shellStr})，攻击者如果获得容器访问权，可以使用它执行任意命令。`,
        evidence: `SHELL ${shellStr}`,
        remediation: '考虑使用受限 shell 或从镜像中移除不必要的 shell。',
      });
    }
  }

  const cmd = config.Cmd || [];
  const entrypoint = config.Entrypoint || [];
  const startCmd = [...entrypoint, ...cmd].join(' ');

  if (/tail\s+-f|sleep\s+infinity|while\s+true/.test(startCmd)) {
    risks.push({
      id: 'RT-017',
      severity: 'Medium',
      category: 'Runtime',
      title: '容器可能运行在调试模式',
      description: '启动命令包含 tail -f 或 sleep infinity 等模式，这通常是调试模式，不应在生产环境中使用。',
      evidence: `CMD/ENTRYPOINT: ${startCmd}`,
      remediation: '确保容器启动命令运行实际的应用程序，而不是保持容器运行的占位符命令。',
    });
  }

  return risks;
}

function checkArchitecture(config: ImageConfig): RuntimeRisk[] {
  const risks: RuntimeRisk[] = [];

  if (config.architecture === 'amd64') {
    // Common, no issue
  } else if (config.architecture === 'arm' || config.architecture === 'arm64') {
    risks.push({
      id: 'RT-018',
      severity: 'Low',
      category: 'Architecture',
      title: '非标准架构镜像',
      description: `镜像使用 ${config.architecture} 架构，确保目标部署环境支持该架构。`,
      evidence: `Architecture: ${config.architecture}, OS: ${config.os}`,
      remediation: '确认部署环境与镜像架构兼容，或构建多架构镜像。',
    });
  }

  return risks;
}

function sortRisksBySeverity(risks: RuntimeRisk[]): RuntimeRisk[] {
  return [...risks].sort((a, b) => {
    const orderA = SEVERITY_ORDER[a.severity] ?? 999;
    const orderB = SEVERITY_ORDER[b.severity] ?? 999;
    return orderA - orderB;
  });
}

const SEVERITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  Unknown: 4,
};
