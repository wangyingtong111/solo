"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestImage = createTestImage;
exports.createVulnerableTestImage = createVulnerableTestImage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tar = __importStar(require("tar"));
async function createTestImage(outputPath, imageConfig) {
    const tmpDir = path.join(require('os').tmpdir(), `dockerscan_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
        const layerDirs = [];
        for (let i = 0; i < imageConfig.layers.length; i++) {
            const layerDir = path.join(tmpDir, `layer_${i}`);
            fs.mkdirSync(layerDir, { recursive: true });
            layerDirs.push(layerDir);
            const layerCfg = imageConfig.layers[i];
            for (const file of layerCfg.files) {
                const filePath = path.join(layerDir, file.path);
                const dir = path.dirname(filePath);
                fs.mkdirSync(dir, { recursive: true });
                if (file.type === 'directory') {
                    fs.mkdirSync(filePath, { recursive: true });
                }
                else {
                    fs.writeFileSync(filePath, file.content || '');
                    if (file.mode) {
                        fs.chmodSync(filePath, file.mode);
                    }
                }
            }
            if (layerCfg.packages) {
                const dpkgDir = path.join(layerDir, 'var/lib/dpkg');
                fs.mkdirSync(dpkgDir, { recursive: true });
                const dpkgPkgs = layerCfg.packages.filter((p) => p.manager === 'dpkg');
                if (dpkgPkgs.length > 0) {
                    const statusContent = dpkgPkgs
                        .map((p) => `Package: ${p.name}\nVersion: ${p.version}\nStatus: install ok installed\n`)
                        .join('\n');
                    fs.writeFileSync(path.join(dpkgDir, 'status'), statusContent);
                }
                const apkPkgs = layerCfg.packages.filter((p) => p.manager === 'apk');
                if (apkPkgs.length > 0) {
                    const apkDir = path.join(layerDir, 'lib/apk/db');
                    fs.mkdirSync(apkDir, { recursive: true });
                    const apkContent = apkPkgs
                        .map((p) => `P:${p.name}\nV:${p.version}\n`)
                        .join('\n');
                    fs.writeFileSync(path.join(apkDir, 'installed'), apkContent);
                }
                const npmPkgs = layerCfg.packages.filter((p) => p.manager === 'npm');
                if (npmPkgs.length > 0) {
                    const nmDir = path.join(layerDir, 'usr/lib/node_modules');
                    fs.mkdirSync(nmDir, { recursive: true });
                    for (const pkg of npmPkgs) {
                        const pkgDir = path.join(nmDir, pkg.name);
                        fs.mkdirSync(pkgDir, { recursive: true });
                        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2));
                    }
                }
                const pipPkgs = layerCfg.packages.filter((p) => p.manager === 'pip');
                if (pipPkgs.length > 0) {
                    const spDir = path.join(layerDir, 'usr/lib/python3.11/site-packages');
                    fs.mkdirSync(spDir, { recursive: true });
                    for (const pkg of pipPkgs) {
                        const distDir = path.join(spDir, `${pkg.name}-${pkg.version}.dist-info`);
                        fs.mkdirSync(distDir, { recursive: true });
                        fs.writeFileSync(path.join(distDir, 'METADATA'), `Name: ${pkg.name}\nVersion: ${pkg.version}\n`);
                    }
                }
            }
            const tarPath = path.join(tmpDir, `layer_${i}.tar`);
            await tar.c({
                cwd: layerDir,
                file: tarPath,
            }, ['.']);
        }
        const layerTars = layerDirs.map((_, i) => `layer_${i}.tar`);
        const imageConfigObj = {
            architecture: 'amd64',
            os: 'linux',
            config: imageConfig.config || {
                User: '',
                ExposedPorts: {},
                Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
                Cmd: ['/bin/sh'],
                Volumes: {},
                WorkingDir: '/',
            },
            rootfs: {
                type: 'layers',
                diff_ids: layerTars.map((_, i) => `sha256:layer${i}hash`),
            },
            history: layerTars.map((_, i) => ({
                created: new Date().toISOString(),
                created_by: `/bin/sh -c #(nop) ADD layer ${i}`,
            })),
            created: new Date().toISOString(),
        };
        const configFileName = `${Date.now()}.json`;
        fs.writeFileSync(path.join(tmpDir, configFileName), JSON.stringify(imageConfigObj, null, 2));
        const manifest = [
            {
                Config: configFileName,
                RepoTags: [`${imageConfig.name}:latest`],
                Layers: layerTars,
            },
        ];
        fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        const outDir = path.dirname(outputPath);
        if (outDir) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        await tar.c({
            cwd: tmpDir,
            file: outputPath,
        }, ['.']);
        console.log(`✅ 测试镜像已创建: ${outputPath}`);
        console.log(`   层数: ${layerTars.length}`);
        const totalPkgs = imageConfig.layers.reduce((sum, l) => sum + (l.packages?.length || 0), 0);
        console.log(`   软件包数量: ${totalPkgs}`);
    }
    finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
async function createVulnerableTestImage(outputPath) {
    await createTestImage(outputPath, {
        name: 'vulnerable-test',
        config: {
            User: 'root',
            ExposedPorts: {
                '22/tcp': {},
                '3306/tcp': {},
                '8080/tcp': {},
            },
            Env: [
                'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                'DB_PASSWORD=supersecret123',
                'AWS_SECRET_KEY=AKIAIOSFODNN7EXAMPLE',
            ],
            Cmd: ['tail', '-f', '/dev/null'],
            Volumes: {
                '/var/run/docker.sock': {},
                '/etc/shadow': {},
            },
            WorkingDir: '/app',
        },
        layers: [
            {
                files: [
                    { path: '/bin/sh', content: '#!/bin/sh', mode: 0o755 },
                    { path: '/etc/passwd', content: 'root:x:0:0:root:/root:/bin/bash\n' },
                ],
                packages: [
                    { name: 'openssl', version: '3.0.10', manager: 'dpkg' },
                    { name: 'glibc', version: '2.35', manager: 'dpkg' },
                    { name: 'zlib', version: '1.2.13', manager: 'dpkg' },
                    { name: 'curl', version: '8.0.0', manager: 'dpkg' },
                    { name: 'bash', version: '5.2.0', manager: 'dpkg' },
                ],
            },
            {
                files: [
                    { path: '/root/.ssh/id_rsa', content: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n', mode: 0o600 },
                    { path: '/root/.docker/config.json', content: '{"auths":{"registry.example.com":{"auth":"dXNlcjpwYXNz"}}}', mode: 0o600 },
                    { path: '/app/index.js', content: 'console.log("hello");\n' },
                    { path: '/bin/chmod', content: '', mode: 0o4755 },
                    { path: '/usr/bin/find', content: '', mode: 0o4755 },
                ],
                packages: [
                    { name: 'libxml2', version: '2.11.0', manager: 'dpkg' },
                    { name: 'busybox', version: '1.35.0', manager: 'dpkg' },
                ],
            },
            {
                files: [
                    { path: '/app/package.json', content: '{"name":"test","version":"1.0.0"}' },
                ],
                packages: [
                    { name: 'lodash', version: '4.17.20', manager: 'npm' },
                    { name: 'pg', version: '8.10.0', manager: 'npm' },
                    { name: 'pip', version: '23.0.0', manager: 'pip' },
                    { name: 'musl', version: '1.2.3', manager: 'apk' },
                ],
            },
        ],
    });
}
if (require.main === module) {
    const args = process.argv.slice(2);
    const output = args[0] || 'test-image.tar';
    createVulnerableTestImage(output)
        .then(() => console.log('完成!'))
        .catch((e) => {
        console.error('错误:', e);
        process.exit(1);
    });
}
//# sourceMappingURL=test-image.js.map