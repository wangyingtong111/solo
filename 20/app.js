// ============================================================================
//  实时高模减面工具 - 核心应用逻辑
//  高性能网格简化 | 硬边保护 | UV接缝保护 | 纹理误差控制 | 误差可视化
// ============================================================================

'use strict';

// ----------------------------------------------------------------------------
// 全局状态管理
// ----------------------------------------------------------------------------
const State = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
    
    originalMesh: null,
    originalGeometry: null,
    originalData: null,
    decimatedMesh: null,
    decimatedGeometry: null,
    
    originalMaterials: [],
    textures: [],
    
    boundingBox: null,
    boundingSphere: null,
    bboxDiagonal: 0,
    
    stats: {
        originalFaces: 0,
        originalVertices: 0,
        decimatedFaces: 0,
        decimatedVertices: 0,
        executionTime: 0,
        memoryDelta: 0,
        geoError: 0,
        texError: 0,
        memoryBaseline: 0
    },
    
    params: {
        targetFaces: 50000,
        hardEdgeAngle: 60,
        uvSeamWeight: 1.0,
        textureErrorThreshold: 2,
        preserveBorders: true,
        errorThreshold: 0.1
    },
    
    showOriginal: true,
    showDecimated: true,
    showErrorOverlay: true,
    
    errorOverlayCanvas: null,
    errorOverlayCtx: null
};

// ----------------------------------------------------------------------------
// 初始化Three.js场景
// ----------------------------------------------------------------------------
function initThreeJS() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    State.scene = new THREE.Scene();
    State.scene.background = new THREE.Color(0x1a1a2e);
    
    State.camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 10000);
    State.camera.position.set(5, 3, 5);
    
    State.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    State.renderer.setSize(width, height);
    State.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    State.renderer.shadowMap.enabled = true;
    State.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(State.renderer.domElement);
    
    State.controls = new THREE.OrbitControls(State.camera, State.renderer.domElement);
    State.controls.enableDamping = true;
    State.controls.dampingFactor = 0.05;
    
    setupLighting();
    setupGridAndAxes();
    setupErrorOverlay();
    
    window.addEventListener('resize', onWindowResize);
    animate();
}

function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    State.scene.add(ambientLight);
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(10, 15, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 100;
    mainLight.shadow.camera.left = -20;
    mainLight.shadow.camera.right = 20;
    mainLight.shadow.camera.top = 20;
    mainLight.shadow.camera.bottom = -20;
    State.scene.add(mainLight);
    
    const fillLight = new THREE.DirectionalLight(0x88aaff, 0.4);
    fillLight.position.set(-5, 3, -5);
    State.scene.add(fillLight);
    
    const rimLight = new THREE.DirectionalLight(0xffaa88, 0.3);
    rimLight.position.set(0, 5, -10);
    State.scene.add(rimLight);
}

function setupGridAndAxes() {
    const gridHelper = new THREE.GridHelper(20, 20, 0x0f3460, 0x0a1628);
    State.scene.add(gridHelper);
}

function setupErrorOverlay() {
    State.errorOverlayCanvas = document.getElementById('error-overlay');
    State.errorOverlayCtx = State.errorOverlayCanvas.getContext('2d');
    resizeErrorOverlay();
}

function resizeErrorOverlay() {
    const container = document.getElementById('viewport');
    State.errorOverlayCanvas.width = container.clientWidth;
    State.errorOverlayCanvas.height = container.clientHeight;
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    State.camera.aspect = width / height;
    State.camera.updateProjectionMatrix();
    State.renderer.setSize(width, height);
    resizeErrorOverlay();
}

function animate() {
    requestAnimationFrame(animate);
    State.controls.update();
    State.renderer.render(State.scene, State.camera);
    
    if (State.showErrorOverlay && State.decimatedMesh && State.originalMesh) {
        updateErrorOverlay();
    }
}

// ----------------------------------------------------------------------------
// 模型加载模块
// ----------------------------------------------------------------------------
document.getElementById('file-input').addEventListener('change', handleFileSelect);

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    showLoading('加载模型中...');
    const extension = file.name.split('.').pop().toLowerCase();
    
    const reader = new FileReader();
    reader.onload = function(e) {
        if (extension === 'obj') {
            loadOBJ(e.target.result);
        } else if (extension === 'gltf' || extension === 'glb') {
            loadGLTF(e.target.result, extension === 'glb');
        } else {
            alert('不支持的文件格式，请上传 OBJ 或 GLTF/GLB 文件');
            hideLoading();
        }
    };
    
    if (extension === 'glb') {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
}

function loadOBJ(content) {
    const loader = new THREE.OBJLoader();
    try {
        const object = loader.parse(content);
        processLoadedModel(object);
    } catch (error) {
        console.error('OBJ加载错误:', error);
        alert('模型加载失败: ' + error.message);
        hideLoading();
    }
}

function loadGLTF(content, isBinary) {
    const loader = new THREE.GLTFLoader();
    try {
        if (isBinary) {
            loader.parse(content, '', function(gltf) {
                processLoadedModel(gltf.scene);
            }, function(error) {
                console.error('GLTF加载错误:', error);
                alert('模型加载失败: ' + error.message);
                hideLoading();
            });
        } else {
            loader.parse(content, '', function(gltf) {
                processLoadedModel(gltf.scene);
            }, function(error) {
                console.error('GLTF加载错误:', error);
                alert('模型加载失败: ' + error.message);
                hideLoading();
            });
        }
    } catch (error) {
        console.error('GLTF解析错误:', error);
        alert('模型加载失败: ' + error.message);
        hideLoading();
    }
}

function processLoadedModel(object) {
    if (State.originalMesh) {
        State.scene.remove(State.originalMesh);
        State.scene.remove(State.decimatedMesh);
        State.originalMesh.geometry.dispose();
        if (State.decimatedMesh) State.decimatedMesh.geometry.dispose();
    }
    
    let targetMesh = null;
    object.traverse(function(child) {
        if (child.isMesh) {
            targetMesh = child;
        }
    });
    
    if (!targetMesh) {
        alert('未在文件中找到网格数据');
        hideLoading();
        return;
    }
    
    let geometry = targetMesh.geometry.clone();
    geometry = ensureTriangulated(geometry);
    geometry = ensureValidGeometry(geometry);
    
    State.originalGeometry = geometry;
    State.originalMaterials = targetMesh.material ? 
        (Array.isArray(targetMesh.material) ? targetMesh.material : [targetMesh.material]) : [];
    
    State.boundingBox = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
    State.boundingSphere = new THREE.Sphere();
    State.boundingBox.getBoundingSphere(State.boundingSphere);
    State.bboxDiagonal = State.boundingBox.min.distanceTo(State.boundingBox.max);
    
    State.textures = [];
    State.originalMaterials.forEach(mat => {
        if (mat.map) State.textures.push(mat.map);
        if (mat.normalMap) State.textures.push(mat.normalMap);
        if (mat.roughnessMap) State.textures.push(mat.roughnessMap);
        if (mat.metalnessMap) State.textures.push(mat.metalnessMap);
    });
    
    const originalMaterial = new THREE.MeshStandardMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });
    
    State.originalMesh = new THREE.Mesh(geometry, originalMaterial);
    State.originalMesh.castShadow = true;
    State.originalMesh.receiveShadow = true;
    State.scene.add(State.originalMesh);
    
    State.stats.originalFaces = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
    State.stats.originalVertices = geometry.getAttribute('position').count;
    
    State.originalData = extractGeometryData(geometry);
    
    updateOriginalStats();
    frameCamera();
    document.getElementById('decimate-btn').disabled = false;
    updateStatus('模型加载完成，点击"一键减面"开始处理');
    hideLoading();
    
    if (performance.memory) {
        State.stats.memoryBaseline = performance.memory.usedJSHeapSize;
    }
}

function ensureTriangulated(geometry) {
    if (geometry.index) return geometry;
    
    const position = geometry.getAttribute('position');
    const count = position.count;
    
    if (count % 3 !== 0) {
        console.warn('顶点数不是3的倍数，可能包含非三角面');
    }
    
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    
    return geometry;
}

function ensureValidGeometry(geometry) {
    if (!geometry.getAttribute('normal')) {
        geometry.computeVertexNormals();
    }
    
    if (!geometry.getAttribute('uv')) {
        const position = geometry.getAttribute('position');
        const count = position.count;
        const uvs = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            uvs[i * 2] = (position.getX(i) + 1) * 0.5;
            uvs[i * 2 + 1] = (position.getY(i) + 1) * 0.5;
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }
    
    return geometry;
}

function extractGeometryData(geometry) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const indices = geometry.index ? geometry.index.array : null;
    
    const vertexCount = position.count;
    const indexCount = indices ? indices.length : vertexCount;
    
    return {
        positions: new Float32Array(position.array),
        normals: normal ? new Float32Array(normal.array) : null,
        uvs: uv ? new Float32Array(uv.array) : null,
        indices: indices ? new Uint32Array(indices) : null,
        vertexCount,
        indexCount
    };
}

function frameCamera() {
    if (!State.boundingSphere) return;
    
    const center = State.boundingSphere.center;
    const radius = State.boundingSphere.radius;
    
    const distance = radius * 2.5 / Math.tan(State.camera.fov * Math.PI / 360);
    State.camera.position.copy(center).add(new THREE.Vector3(distance * 0.8, distance * 0.6, distance));
    State.camera.lookAt(center);
    
    State.controls.target.copy(center);
    State.controls.update();
}

// ----------------------------------------------------------------------------
// 测试模型生成 (500万面高精度模型)
// ----------------------------------------------------------------------------
function loadDemoModel() {
    showLoading('生成约10万面测试模型中...');
    
    setTimeout(() => {
        const geometry = generateHighPolyModel(100000);
        const material = new THREE.MeshStandardMaterial({ color: 0x88ccff });
        const mesh = new THREE.Mesh(geometry, material);
        
        const group = new THREE.Group();
        group.add(mesh);
        processLoadedModel(group);
    }, 100);
}

function generateHighPolyModel(targetFaces) {
    const geometry = new THREE.BufferGeometry();
    
    const baseIcosahedron = createIcosahedron();
    const subdivisions = Math.ceil(Math.log(targetFaces / 20) / Math.log(4));
    
    let positions = baseIcosahedron.positions;
    let indices = baseIcosahedron.indices;
    
    let faceCount = 20;
    for (let i = 0; i < subdivisions; i++) {
        const result = subdivideMesh(positions, indices);
        positions = result.positions;
        indices = result.indices;
        faceCount = indices.length / 3;
        
        if (faceCount >= targetFaces) break;
    }
    
    positions = displaceVertices(positions, indices);
    
    const vertexCount = positions.length / 3;
    const normals = new Float32Array(positions.length);
    const uvs = new Float32Array(vertexCount * 2);
    
    computeNormals(positions, indices, normals);
    computeUVs(positions, uvs, vertexCount);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    
    return geometry;
}

function createIcosahedron() {
    const t = (1 + Math.sqrt(5)) / 2;
    
    const positions = new Float32Array([
        -1,  t,  0,  1,  t,  0, -1, -t,  0,  1, -t,  0,
         0, -1,  t,  0,  1,  t,  0, -1, -t,  0,  1, -t,
         t,  0, -1,  t,  0,  1, -t,  0, -1, -t,  0,  1
    ]);
    
    for (let i = 0; i < positions.length; i += 3) {
        const len = Math.hypot(positions[i], positions[i+1], positions[i+2]);
        positions[i] /= len;
        positions[i+1] /= len;
        positions[i+2] /= len;
    }
    
    const indices = new Uint32Array([
        0, 11,  5,  0,  5,  1,  0,  1,  7,  0,  7, 10,  0, 10, 11,
         1,  5,  9,  5, 11,  4, 11, 10,  2, 10,  7,  6,  7,  1,  8,
         3,  9,  4,  3,  4,  2,  3,  2,  6,  3,  6,  8,  3,  8,  9,
         4,  9,  5,  2,  4, 11,  6,  2, 10,  8,  6,  7,  9,  8,  1
    ]);
    
    return { positions, indices };
}

function subdivideMesh(positions, indices) {
    const midpointCache = new Map();
    const vertexCount = positions.length / 3;
    const faceCount = indices.length / 3;
    const edgeCount = Math.floor(faceCount * 1.5);
    const maxVertices = vertexCount + edgeCount + 100;
    const newPositions = new Float32Array(maxVertices * 3);
    const newIndices = new Uint32Array(indices.length * 4);
    
    newPositions.set(positions);
    let currentVertexCount = vertexCount;
    
    for (let i = 0; i < indices.length; i += 3) {
        const v0 = indices[i];
        const v1 = indices[i+1];
        const v2 = indices[i+2];
        
        const a = getMidpoint(v0, v1, positions, newPositions, midpointCache, vertexCount);
        const b = getMidpoint(v1, v2, positions, newPositions, midpointCache, vertexCount);
        const c = getMidpoint(v2, v0, positions, newPositions, midpointCache, vertexCount);
        
        if (a >= currentVertexCount) currentVertexCount++;
        if (b >= currentVertexCount) currentVertexCount++;
        if (c >= currentVertexCount) currentVertexCount++;
        
        const baseIdx = i * 4;
        newIndices[baseIdx] = v0;
        newIndices[baseIdx+1] = a;
        newIndices[baseIdx+2] = c;
        newIndices[baseIdx+3] = v1;
        newIndices[baseIdx+4] = b;
        newIndices[baseIdx+5] = a;
        newIndices[baseIdx+6] = v2;
        newIndices[baseIdx+7] = c;
        newIndices[baseIdx+8] = b;
        newIndices[baseIdx+9] = a;
        newIndices[baseIdx+10] = b;
        newIndices[baseIdx+11] = c;
    }
    
    return {
        positions: newPositions.slice(0, currentVertexCount * 3),
        indices: newIndices
    };
}

function getMidpoint(v1, v2, oldPositions, newPositions, cache, vertexCount) {
    const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
    
    if (cache.has(key)) {
        return cache.get(key);
    }
    
    const i1 = v1 * 3;
    const i2 = v2 * 3;
    
    const x = (oldPositions[i1] + oldPositions[i2]) * 0.5;
    const y = (oldPositions[i1+1] + oldPositions[i2+1]) * 0.5;
    const z = (oldPositions[i1+2] + oldPositions[i2+2]) * 0.5;
    
    const len = Math.hypot(x, y, z);
    const idx = vertexCount + cache.size;
    const oi = idx * 3;
    
    newPositions[oi] = x / len;
    newPositions[oi+1] = y / len;
    newPositions[oi+2] = z / len;
    
    cache.set(key, idx);
    return idx;
}

function displaceVertices(positions, indices) {
    const vertexCount = positions.length / 3;
    const noiseScale = 0.15;
    const noiseFreq = 4;
    
    for (let i = 0; i < vertexCount; i++) {
        const oi = i * 3;
        const x = positions[oi];
        const y = positions[oi+1];
        const z = positions[oi+2];
        
        const noise = fbm(x * noiseFreq, y * noiseFreq, z * noiseFreq, 4);
        const displacement = 1 + noise * noiseScale;
        
        positions[oi] = x * displacement;
        positions[oi+1] = y * displacement;
        positions[oi+2] = z * displacement;
    }
    
    return positions;
}

function fbm(x, y, z, octaves) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    
    for (let i = 0; i < octaves; i++) {
        value += amplitude * noise3D(x * frequency, y * frequency, z * frequency);
        amplitude *= 0.5;
        frequency *= 2;
    }
    
    return value;
}

function noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    
    const p = permutation();
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    
    return lerp(w, lerp(v, lerp(u, grad(p[AA], x, y, z),
                                   grad(p[BA], x - 1, y, z)),
                           lerp(u, grad(p[AB], x, y - 1, z),
                                   grad(p[BB], x - 1, y - 1, z))),
                   lerp(v, lerp(u, grad(p[AA + 1], x, y, z - 1),
                                   grad(p[BA + 1], x - 1, y, z - 1)),
                           lerp(u, grad(p[AB + 1], x, y - 1, z - 1),
                                   grad(p[BB + 1], x - 1, y - 1, z - 1))));
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t, a, b) { return a + t * (b - a); }
function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

let _perm = null;
function permutation() {
    if (_perm) return _perm;
    const p = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [base[i], base[j]] = [base[j], base[i]];
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    _perm = p;
    return p;
}

function computeNormals(positions, indices, normals) {
    const faceCount = indices.length / 3;
    
    for (let i = 0; i < faceCount; i++) {
        const i0 = indices[i*3] * 3;
        const i1 = indices[i*3+1] * 3;
        const i2 = indices[i*3+2] * 3;
        
        const v0x = positions[i0], v0y = positions[i0+1], v0z = positions[i0+2];
        const v1x = positions[i1], v1y = positions[i1+1], v1z = positions[i1+2];
        const v2x = positions[i2], v2y = positions[i2+1], v2z = positions[i2+2];
        
        const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
        const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
        
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; }
        
        normals[i0] += nx; normals[i0+1] += ny; normals[i0+2] += nz;
        normals[i1] += nx; normals[i1+1] += ny; normals[i1+2] += nz;
        normals[i2] += nx; normals[i2+1] += ny; normals[i2+2] += nz;
    }
    
    const vertexCount = positions.length / 3;
    for (let i = 0; i < vertexCount; i++) {
        const oi = i * 3;
        const len = Math.hypot(normals[oi], normals[oi+1], normals[oi+2]);
        if (len > 0) {
            normals[oi] /= len;
            normals[oi+1] /= len;
            normals[oi+2] /= len;
        }
    }
}

function computeUVs(positions, uvs, vertexCount) {
    for (let i = 0; i < vertexCount; i++) {
        const oi = i * 3;
        const x = positions[oi];
        const y = positions[oi+1];
        const z = positions[oi+2];
        
        uvs[i*2] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
        uvs[i*2+1] = Math.asin(y) / Math.PI + 0.5;
    }
}

// ----------------------------------------------------------------------------
// 核心减面算法 - 基于边折叠的QSlim算法
// ----------------------------------------------------------------------------
function startDecimation() {
    if (!State.originalMesh) return;
    
    updateParamsFromUI();
    showLoading('正在执行减面算法...');
    updateProgress(0);
    updateStatus('分析网格拓扑...');
    
    setTimeout(() => {
        const startTime = performance.now();
        const memoryStart = performance.memory ? performance.memory.usedJSHeapSize : 0;
        
        try {
            const result = decimateMesh(State.originalData, State.params);
            
            const endTime = performance.now();
            const memoryEnd = performance.memory ? performance.memory.usedJSHeapSize : 0;
            
            State.stats.executionTime = endTime - startTime;
            State.stats.memoryDelta = (memoryEnd - memoryStart) / (1024 * 1024);
            State.stats.decimatedFaces = result.faceCount;
            State.stats.decimatedVertices = result.vertexCount;
            State.stats.geoError = result.geoError;
            State.stats.texError = result.texError;
            
            createDecimatedMesh(result);
            updateResultStats();
            updatePerformanceMetrics();
            
            updateStatus(`减面完成！${State.stats.originalFaces.toLocaleString()} → ${State.stats.decimatedFaces.toLocaleString()} 面`);
            updateProgress(100);
            
        } catch (error) {
            console.error('减面错误:', error);
            console.error('错误堆栈:', error.stack);
            updateStatus('减面失败: ' + error.message);
        }
        
        hideLoading();
    }, 50);
}

function updateParamsFromUI() {
    State.params.targetFaces = parseInt(document.getElementById('target-faces').value);
    State.params.hardEdgeAngle = parseFloat(document.getElementById('hard-angle').value);
    State.params.uvSeamWeight = parseFloat(document.getElementById('uv-seam').value);
    State.params.textureErrorThreshold = parseFloat(document.getElementById('texture-error').value);
    State.params.preserveBorders = document.getElementById('preserve-borders').checked;
    State.params.errorThreshold = parseFloat(document.getElementById('error-threshold').value);
}

function decimateMesh(data, params) {
    updateProgress(10, '分析边和拓扑结构...');
    
    const hardEdgeRadians = params.hardEdgeAngle * Math.PI / 180;
    const cosHardAngle = Math.cos(hardEdgeRadians);
    
    const { positions, normals, uvs, indices, vertexCount, indexCount } = data;
    const faceCount = indexCount / 3;
    
    console.log('decimateMesh: vertexCount=' + vertexCount + ', faceCount=' + faceCount);
    console.log('decimateMesh: indices=' + (indices ? indices.length : 'null'));
    console.log('decimateMesh: normals=' + (normals ? normals.length : 'null'));
    console.log('decimateMesh: uvs=' + (uvs ? uvs.length : 'null'));
    
    updateProgress(20, '计算边信息和硬边标记...');
    
    const edges = buildEdgeData(indices, positions, normals, uvs, vertexCount, faceCount, cosHardAngle, params);
    console.log('decimateMesh: edges built, count=' + edges.length);
    
    updateProgress(35, '构建二次误差矩阵...');
    
    const Q = buildQuadricErrorMatrices(positions, normals, indices, faceCount, vertexCount);
    console.log('decimateMesh: Q built');
    
    updateProgress(50, '计算边折叠成本...');
    
    const heap = buildEdgeHeap(edges, Q, positions, uvs, params, vertexCount);
    console.log('decimateMesh: heap built, size=' + heap.length);
    
    updateProgress(65, '执行边折叠...');
    
    const targetFaceCount = params.targetFaces;
    const result = performEdgeCollapse(
        positions, normals, uvs, indices,
        Q, edges, heap, vertexCount, faceCount,
        targetFaceCount, params
    );
    console.log('decimateMesh: edge collapse done');
    
    updateProgress(85, '重新计算法线...');
    
    recomputeNormalsWithHardEdges(result, params.hardEdgeAngle);
    console.log('decimateMesh: normals recomputed');
    
    updateProgress(90, '修复UV数据...');
    
    if (result.uvs) {
        const vertFaces = new Array(result.vertexCount);
        for (let i = 0; i < result.vertexCount; i++) vertFaces[i] = [];
        for (let fi = 0; fi < result.faceCount; fi++) {
            const i0 = result.indices[fi*3];
            const i1 = result.indices[fi*3+1];
            const i2 = result.indices[fi*3+2];
            vertFaces[i0].push(fi);
            vertFaces[i1].push(fi);
            vertFaces[i2].push(fi);
        }
        for (let i = 0; i < result.vertexCount; i++) {
            const u = result.uvs[i*2];
            const v = result.uvs[i*2+1];
            if (!isFinite(u) || !isFinite(v)) {
                const faces = vertFaces[i] || [];
                let found = false;
                for (let k = 0; k < faces.length; k++) {
                    const fi = faces[k];
                    const i0 = result.indices[fi*3];
                    const i1 = result.indices[fi*3+1];
                    const i2 = result.indices[fi*3+2];
                    const other = i0 === i ? i1 : (i1 === i ? i2 : i0);
                    const ou = result.uvs[other*2];
                    const ov = result.uvs[other*2+1];
                    if (isFinite(ou) && isFinite(ov)) {
                        result.uvs[i*2] = ou;
                        result.uvs[i*2+1] = ov;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    result.uvs[i*2] = 0;
                    result.uvs[i*2+1] = 0;
                }
            }
        }
    }
    
    updateProgress(95, '计算误差度量...');
    
    const geoError = computeGeometricError(data, result);
    const texError = computeTextureError(data, result);
    console.log('decimateMesh: errors computed, geo=' + geoError + ', tex=' + texError);
    
    return {
        positions: result.positions,
        normals: result.normals,
        uvs: result.uvs,
        indices: result.indices,
        vertexCount: result.vertexCount,
        faceCount: result.faceCount,
        geoError,
        texError
    };
}

function buildEdgeData(indices, positions, normals, uvs, vertexCount, faceCount, cosHardAngle, params) {
    const edgeMap = new Map();
    const edges = [];
    
    for (let fi = 0; fi < faceCount; fi++) {
        const i0 = indices[fi*3];
        const i1 = indices[fi*3+1];
        const i2 = indices[fi*3+2];
        
        processEdge(i0, i1, fi, indices, positions, normals, uvs, edgeMap, edges, cosHardAngle, params);
        processEdge(i1, i2, fi, indices, positions, normals, uvs, edgeMap, edges, cosHardAngle, params);
        processEdge(i2, i0, fi, indices, positions, normals, uvs, edgeMap, edges, cosHardAngle, params);
    }
    
    for (const edge of edges) {
        if (edge.faceCount === 1) {
            edge.isBorder = true;
        }
        
        if (edge.faceCount === 2) {
            const n1 = getFaceNormal(edge.faces[0], indices, positions);
            const n2 = getFaceNormal(edge.faces[1], indices, positions);
            const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
            edge.isHardEdge = dot < cosHardAngle;
        }
        
        if (uvs && params.uvSeamWeight > 0) {
            const uv0a = new THREE.Vector2(uvs[edge.v0*2], uvs[edge.v0*2+1]);
            const uv0b = new THREE.Vector2(uvs[edge.v1*2], uvs[edge.v1*2+1]);
            const uvDist = uv0a.distanceTo(uv0b);
            edge.isUVSeam = uvDist > 0.1;
        }
    }
    
    return edges;
}

function processEdge(a, b, faceIndex, indices, positions, normals, uvs, edgeMap, edges, cosHardAngle, params) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const v0 = Math.min(a, b);
    const v1 = Math.max(a, b);
    
    if (edgeMap.has(key)) {
        const edge = edgeMap.get(key);
        edge.faceCount++;
        edge.faces.push(faceIndex);
    } else {
        const edge = {
            v0, v1,
            faceCount: 1,
            faces: [faceIndex],
            isBorder: false,
            isHardEdge: false,
            isUVSeam: false,
            collapsed: false,
            cost: 0,
            target: new Float32Array(3)
        };
        edgeMap.set(key, edge);
        edges.push(edge);
    }
}

function getFaceNormal(faceIndex, indices, positions) {
    const i0 = indices[faceIndex*3] * 3;
    const i1 = indices[faceIndex*3+1] * 3;
    const i2 = indices[faceIndex*3+2] * 3;
    
    const v0x = positions[i0], v0y = positions[i0+1], v0z = positions[i0+2];
    const v1x = positions[i1], v1y = positions[i1+1], v1z = positions[i1+2];
    const v2x = positions[i2], v2y = positions[i2+1], v2z = positions[i2+2];
    
    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
    
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }
    
    return { x: nx, y: ny, z: nz };
}

function buildQuadricErrorMatrices(positions, normals, indices, faceCount, vertexCount) {
    const Q = new Float32Array(vertexCount * 10);
    
    for (let i = 0; i < faceCount; i++) {
        const i0 = indices[i*3];
        const i1 = indices[i*3+1];
        const i2 = indices[i*3+2];
        
        const normal = getFaceNormal(i, indices, positions);
        const px = positions[i0*3];
        const py = positions[i0*3+1];
        const pz = positions[i0*3+2];
        
        const d = -(normal.x * px + normal.y * py + normal.z * pz);
        
        const a = normal.x, b = normal.y, c = normal.z;
        
        const K0 = a*a, K1 = a*b, K2 = a*c, K3 = a*d;
        const K4 = b*b, K5 = b*c, K6 = b*d;
        const K7 = c*c, K8 = c*d;
        const K9 = d*d;
        
        addQuadric(Q, i0, K0, K1, K2, K3, K4, K5, K6, K7, K8, K9);
        addQuadric(Q, i1, K0, K1, K2, K3, K4, K5, K6, K7, K8, K9);
        addQuadric(Q, i2, K0, K1, K2, K3, K4, K5, K6, K7, K8, K9);
    }
    
    return Q;
}

function addQuadric(Q, vi, K0, K1, K2, K3, K4, K5, K6, K7, K8, K9) {
    const oi = vi * 10;
    Q[oi] += K0;
    Q[oi+1] += K1;
    Q[oi+2] += K2;
    Q[oi+3] += K3;
    Q[oi+4] += K4;
    Q[oi+5] += K5;
    Q[oi+6] += K6;
    Q[oi+7] += K7;
    Q[oi+8] += K8;
    Q[oi+9] += K9;
}

function buildEdgeHeap(edges, Q, positions, uvs, params, vertexCount) {
    const heap = [];
    
    for (const edge of edges) {
        if (edge.isBorder && params.preserveBorders) {
            edge.cost = Infinity;
            continue;
        }
        
        if (edge.isHardEdge) {
            edge.cost = Infinity;
            continue;
        }
        
        const costInfo = computeEdgeCollapseCost(edge, Q, positions, uvs, params);
        edge.cost = costInfo.cost;
        edge.target = costInfo.target;
        
        if (isFinite(edge.cost)) {
            heap.push(edge);
        }
    }
    
    heapify(heap);
    
    return heap;
}

function computeEdgeCollapseCost(edge, Q, positions, uvs, params) {
    const { v0, v1 } = edge;
    
    const Q0 = Q.subarray(v0 * 10, v0 * 10 + 10);
    const Q1 = Q.subarray(v1 * 10, v1 * 10 + 10);
    
    const Qe = new Float32Array(10);
    for (let i = 0; i < 10; i++) {
        Qe[i] = Q0[i] + Q1[i];
    }
    
    let target, cost;
    
    const optimalTarget = findOptimalVertex(Qe, positions, v0, v1);
    if (optimalTarget) {
        target = optimalTarget.position;
        cost = optimalTarget.cost;
    } else {
        const p0 = [positions[v0*3], positions[v0*3+1], positions[v0*3+2]];
        const p1 = [positions[v1*3], positions[v1*3+1], positions[v1*3+2]];
        const mid = [(p0[0]+p1[0])*0.5, (p0[1]+p1[1])*0.5, (p0[2]+p1[2])*0.5];
        
        const cost0 = computeQuadricError(Qe, p0[0], p0[1], p0[2]);
        const cost1 = computeQuadricError(Qe, p1[0], p1[1], p1[2]);
        const costMid = computeQuadricError(Qe, mid[0], mid[1], mid[2]);
        
        if (cost0 <= cost1 && cost0 <= costMid) {
            target = p0;
            cost = cost0;
        } else if (cost1 <= cost0 && cost1 <= costMid) {
            target = p1;
            cost = cost1;
        } else {
            target = mid;
            cost = costMid;
        }
    }
    
    if (edge.isUVSeam && params.uvSeamWeight > 0) {
        cost *= (1 + params.uvSeamWeight);
    }
    
    if (uvs && params.textureErrorThreshold > 0) {
        const uvDist = computeUVStretch(v0, v1, uvs, positions);
        const texturePenalty = uvDist * params.textureErrorThreshold * 10;
        cost += texturePenalty;
    }
    
    return { cost, target };
}

function findOptimalVertex(Qe, positions, v0, v1) {
    const A = new Float32Array([
        Qe[0], Qe[1], Qe[2],
        Qe[1], Qe[4], Qe[5],
        Qe[2], Qe[5], Qe[7]
    ]);
    
    const det = A[0]*(A[4]*A[8]-A[5]*A[7]) - A[1]*(A[1]*A[8]-A[2]*A[7]) + A[2]*(A[1]*A[5]-A[4]*A[2]);
    
    if (Math.abs(det) < 1e-6) return null;
    
    const b = [-Qe[3], -Qe[6], -Qe[8]];
    
    const invDet = 1 / det;
    const invA = new Float32Array([
        (A[4]*A[8] - A[5]*A[7]) * invDet,
        (A[2]*A[7] - A[1]*A[8]) * invDet,
        (A[1]*A[5] - A[2]*A[4]) * invDet,
        (A[5]*A[2] - A[1]*A[8]) * invDet,
        (A[0]*A[8] - A[2]*A[2]) * invDet,
        (A[1]*A[2] - A[0]*A[5]) * invDet,
        (A[1]*A[7] - A[4]*A[2]) * invDet,
        (A[2]*A[1] - A[0]*A[7]) * invDet,
        (A[0]*A[4] - A[1]*A[1]) * invDet
    ]);
    
    const x = invA[0]*b[0] + invA[1]*b[1] + invA[2]*b[2];
    const y = invA[3]*b[0] + invA[4]*b[1] + invA[5]*b[2];
    const z = invA[6]*b[0] + invA[7]*b[1] + invA[8]*b[2];
    
    const cost = computeQuadricError(Qe, x, y, z);
    
    return { position: [x, y, z], cost };
}

function computeQuadricError(Q, x, y, z) {
    return Q[0]*x*x + 2*Q[1]*x*y + 2*Q[2]*x*z + 2*Q[3]*x +
           Q[4]*y*y + 2*Q[5]*y*z + 2*Q[6]*y +
           Q[7]*z*z + 2*Q[8]*z +
           Q[9];
}

function computeUVStretch(v0, v1, uvs, positions) {
    if (!uvs) return 0;
    
    const uv0 = [uvs[v0*2], uvs[v0*2+1]];
    const uv1 = [uvs[v1*2], uvs[v1*2+1]];
    const p0 = [positions[v0*3], positions[v0*3+1], positions[v0*3+2]];
    const p1 = [positions[v1*3], positions[v1*3+1], positions[v1*3+2]];
    
    const uvDist = Math.hypot(uv1[0]-uv0[0], uv1[1]-uv0[1]);
    const geoDist = Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]);
    
    if (geoDist < 1e-6) return 0;
    
    return uvDist / geoDist;
}

function heapify(heap) {
    for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
        siftDown(heap, i);
    }
}

function siftDown(heap, i) {
    const length = heap.length;
    while (true) {
        let smallest = i;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        
        if (left < length && heap[left].cost < heap[smallest].cost) {
            smallest = left;
        }
        if (right < length && heap[right].cost < heap[smallest].cost) {
            smallest = right;
        }
        if (smallest === i) break;
        
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        heap[i].heapIndex = i;
        heap[smallest].heapIndex = smallest;
        i = smallest;
    }
}

function siftUp(heap, i) {
    while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (heap[i].cost >= heap[parent].cost) break;
        
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        heap[i].heapIndex = i;
        heap[parent].heapIndex = parent;
        i = parent;
    }
}

function buildVertexFaceAdjacency(indices, vertexCount, faceCount) {
    const adjacency = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        adjacency[i] = [];
    }
    
    for (let fi = 0; fi < faceCount; fi++) {
        const i0 = indices[fi*3];
        const i1 = indices[fi*3+1];
        const i2 = indices[fi*3+2];
        
        adjacency[i0].push(fi);
        adjacency[i1].push(fi);
        adjacency[i2].push(fi);
    }
    
    return adjacency;
}

function buildVertexEdgeAdjacency(edges, vertexCount) {
    const adjacency = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        adjacency[i] = [];
    }
    
    for (const edge of edges) {
        adjacency[edge.v0].push(edge);
        adjacency[edge.v1].push(edge);
    }
    
    return adjacency;
}

function performEdgeCollapse(positions, normals, uvs, indices, Q, edges, heap, vertexCount, faceCount, targetFaceCount, params) {
    const vertexRemap = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) vertexRemap[i] = i;
    
    const activeFaces = new Uint8Array(faceCount);
    for (let i = 0; i < faceCount; i++) activeFaces[i] = 1;
    
    const vertexFaceAdj = buildVertexFaceAdjacency(indices, vertexCount, faceCount);
    const vertexEdgeAdj = buildVertexEdgeAdjacency(edges, vertexCount);
    
    let currentVertexCount = vertexCount;
    let currentFaceCount = faceCount;
    
    for (let i = 0; i < heap.length; i++) {
        heap[i].heapIndex = i;
    }
    
    while (currentFaceCount > targetFaceCount && heap.length > 0) {
        const edge = heap[0];
        
        if (edge.collapsed || !isFinite(edge.cost)) {
            heap[0] = heap[heap.length - 1];
            heap[0].heapIndex = 0;
            heap.pop();
            siftDown(heap, 0);
            continue;
        }
        
        const v0 = edge.v0;
        const v1 = edge.v1;
        
        if (vertexRemap[v0] !== v0 || vertexRemap[v1] !== v1) {
            edge.collapsed = true;
            heap[0] = heap[heap.length - 1];
            if (heap.length > 1) {
                heap[0].heapIndex = 0;
                siftDown(heap, 0);
            }
            heap.pop();
            continue;
        }
        
        const vRemain = v0;
        const vRemove = v1;
        
        const oi = vRemain * 3;
        const oldPos = [positions[oi], positions[oi+1], positions[oi+2]];
        const removePos = [positions[vRemove*3], positions[vRemove*3+1], positions[vRemove*3+2]];
        positions[oi] = edge.target[0];
        positions[oi+1] = edge.target[1];
        positions[oi+2] = edge.target[2];
        
        if (uvs && params.uvSeamWeight > 0) {
            const dx1 = edge.target[0] - oldPos[0];
            const dy1 = edge.target[1] - oldPos[1];
            const dz1 = edge.target[2] - oldPos[2];
            const dx2 = removePos[0] - oldPos[0];
            const dy2 = removePos[1] - oldPos[1];
            const dz2 = removePos[2] - oldPos[2];
            const distFullSq = dx2*dx2 + dy2*dy2 + dz2*dz2;
            let t = 0.5;
            if (distFullSq > 1e-12) {
                const distT = dx1*dx2 + dy1*dy2 + dz1*dz2;
                t = Math.max(0, Math.min(1, distT / distFullSq));
            }
            let u0 = uvs[vRemain*2];
            let v0uv = uvs[vRemain*2+1];
            let u1 = uvs[vRemove*2];
            let v1uv = uvs[vRemove*2+1];
            if (!isFinite(u0) || !isFinite(v0uv)) { u0 = 0; v0uv = 0; }
            if (!isFinite(u1) || !isFinite(v1uv)) { u1 = u0; v1uv = v0uv; }
            let newU = u0 * (1 - t) + u1 * t;
            let newV = v0uv * (1 - t) + v1uv * t;
            if (!isFinite(newU) || !isFinite(newV)) {
                newU = u0;
                newV = v0uv;
            }
            uvs[vRemain*2] = newU;
            uvs[vRemain*2+1] = newV;
        }
        
        vertexRemap[vRemove] = vRemain;
        
        const affectedFaces = new Set();
        for (const fi of vertexFaceAdj[vRemove]) {
            affectedFaces.add(fi);
        }
        for (const fi of vertexFaceAdj[vRemain]) {
            affectedFaces.add(fi);
        }
        
        for (const fi of affectedFaces) {
            if (!activeFaces[fi]) continue;
            
            const i0 = indices[fi*3];
            const i1 = indices[fi*3+1];
            const i2 = indices[fi*3+2];
            
            const r0 = vertexRemap[i0];
            const r1 = vertexRemap[i1];
            const r2 = vertexRemap[i2];
            
            if (r0 === r1 || r1 === r2 || r2 === r0) {
                activeFaces[fi] = 0;
                currentFaceCount--;
                continue;
            }
            
            indices[fi*3] = r0;
            indices[fi*3+1] = r1;
            indices[fi*3+2] = r2;
        }
        
        for (const fi of vertexFaceAdj[vRemove]) {
            if (activeFaces[fi]) {
                vertexFaceAdj[vRemain].push(fi);
            }
        }
        
        const affectedEdges = new Set();
        for (const e of vertexEdgeAdj[vRemove]) {
            affectedEdges.add(e);
        }
        for (const e of vertexEdgeAdj[vRemain]) {
            affectedEdges.add(e);
        }
        
        for (const otherEdge of affectedEdges) {
            if (otherEdge.collapsed) continue;
            if (otherEdge.v0 === vRemove) otherEdge.v0 = vRemain;
            if (otherEdge.v1 === vRemove) otherEdge.v1 = vRemain;
            if (otherEdge.v0 === otherEdge.v1) {
                otherEdge.collapsed = true;
                otherEdge.cost = Infinity;
            }
        }
        
        for (const e of vertexEdgeAdj[vRemove]) {
            if (!e.collapsed) {
                vertexEdgeAdj[vRemain].push(e);
            }
        }
        
        edge.collapsed = true;
        currentVertexCount--;
        
        heap[0] = heap[heap.length - 1];
        if (heap.length > 1) {
            heap[0].heapIndex = 0;
            siftDown(heap, 0);
        }
        heap.pop();
    }
    
    const newPositions = new Float32Array(currentVertexCount * 3);
    const newNormals = new Float32Array(currentVertexCount * 3);
    const newUVs = uvs ? new Float32Array(currentVertexCount * 2) : null;
    
    const newVertexID = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) newVertexID[i] = -1;
    
    let newVCount = 0;
    for (let i = 0; i < vertexCount; i++) {
        if (vertexRemap[i] === i) {
            newVertexID[i] = newVCount;
            newPositions[newVCount*3] = positions[i*3];
            newPositions[newVCount*3+1] = positions[i*3+1];
            newPositions[newVCount*3+2] = positions[i*3+2];
            
            if (normals) {
                newNormals[newVCount*3] = normals[i*3];
                newNormals[newVCount*3+1] = normals[i*3+1];
                newNormals[newVCount*3+2] = normals[i*3+2];
            }
            
            if (uvs) {
                let u = uvs[i*2];
                let v = uvs[i*2+1];
                if (!isFinite(u) || !isFinite(v)) {
                    const adjFaces = vertexFaceAdj[i] || [];
                    let found = false;
                    for (let k = 0; k < adjFaces.length; k++) {
                        const fi = adjFaces[k];
                        if (!activeFaces[fi]) continue;
                        const i0 = indices[fi*3];
                        const i1 = indices[fi*3+1];
                        const i2 = indices[fi*3+2];
                        const other = i0 === i ? i1 : (i1 === i ? i2 : i0);
                        const ou = uvs[other*2];
                        const ov = uvs[other*2+1];
                        if (isFinite(ou) && isFinite(ov)) {
                            u = ou;
                            v = ov;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        u = 0;
                        v = 0;
                    }
                }
                newUVs[newVCount*2] = u;
                newUVs[newVCount*2+1] = v;
            }
            
            newVCount++;
        }
    }
    
    const newFaces = [];
    for (let fi = 0; fi < faceCount; fi++) {
        if (!activeFaces[fi]) continue;
        
        const i0 = newVertexID[indices[fi*3]];
        const i1 = newVertexID[indices[fi*3+1]];
        const i2 = newVertexID[indices[fi*3+2]];
        
        if (i0 >= 0 && i1 >= 0 && i2 >= 0 && i0 !== i1 && i1 !== i2 && i2 !== i0) {
            newFaces.push(i0, i1, i2);
        }
    }
    
    return {
        positions: newPositions,
        normals: newNormals,
        uvs: newUVs,
        indices: new Uint32Array(newFaces),
        vertexCount: newVCount,
        faceCount: newFaces.length / 3
    };
}

function recomputeNormalsWithHardEdges(result, hardEdgeAngle) {
    const { positions, indices, normals, vertexCount, faceCount } = result;
    const hardEdgeRadians = hardEdgeAngle * Math.PI / 180;
    const cosHardAngle = Math.cos(hardEdgeRadians);
    
    const faceNormals = new Float32Array(faceCount * 3);
    for (let i = 0; i < faceCount; i++) {
        const fn = getFaceNormal(i, indices, positions);
        faceNormals[i*3] = fn.x;
        faceNormals[i*3+1] = fn.y;
        faceNormals[i*3+2] = fn.z;
    }
    
    const vertexFaceMap = new Map();
    for (let i = 0; i < faceCount; i++) {
        const i0 = indices[i*3];
        const i1 = indices[i*3+1];
        const i2 = indices[i*3+2];
        
        if (!vertexFaceMap.has(i0)) vertexFaceMap.set(i0, []);
        if (!vertexFaceMap.has(i1)) vertexFaceMap.set(i1, []);
        if (!vertexFaceMap.has(i2)) vertexFaceMap.set(i2, []);
        
        vertexFaceMap.get(i0).push(i);
        vertexFaceMap.get(i1).push(i);
        vertexFaceMap.get(i2).push(i);
    }
    
    for (let vi = 0; vi < vertexCount; vi++) {
        const faces = vertexFaceMap.get(vi) || [];
        if (faces.length === 0) continue;
        
        const normalGroups = [];
        
        for (const fi of faces) {
            const fnx = faceNormals[fi*3];
            const fny = faceNormals[fi*3+1];
            const fnz = faceNormals[fi*3+2];
            
            let grouped = false;
            for (const group of normalGroups) {
                const dot = group.nx * fnx + group.ny * fny + group.nz * fnz;
                if (dot > cosHardAngle) {
                    group.nx += fnx;
                    group.ny += fny;
                    group.nz += fnz;
                    grouped = true;
                    break;
                }
            }
            
            if (!grouped) {
                normalGroups.push({ nx: fnx, ny: fny, nz: fnz });
            }
        }
        
        let bestGroup = normalGroups[0];
        let maxLen = 0;
        for (const group of normalGroups) {
            const len = Math.hypot(group.nx, group.ny, group.nz);
            if (len > maxLen) {
                maxLen = len;
                bestGroup = group;
            }
        }
        
        const len = Math.hypot(bestGroup.nx, bestGroup.ny, bestGroup.nz);
        if (len > 0) {
            normals[vi*3] = bestGroup.nx / len;
            normals[vi*3+1] = bestGroup.ny / len;
            normals[vi*3+2] = bestGroup.nz / len;
        }
    }
}

function computeGeometricError(originalData, result) {
    const sampleCount = Math.min(10000, originalData.vertexCount);
    let maxError = 0;
    let totalError = 0;
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < originalData.positions.length; i += 3) {
        const x = originalData.positions[i];
        const y = originalData.positions[i+1];
        const z = originalData.positions[i+2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    const bboxSize = Math.sqrt((maxX-minX)**2 + (maxY-minY)**2 + (maxZ-minZ)**2);
    if (bboxSize === 0) return 0;
    
    for (let i = 0; i < sampleCount; i++) {
        const idx = Math.floor(Math.random() * originalData.vertexCount);
        const oi = idx * 3;
        
        const px = originalData.positions[oi];
        const py = originalData.positions[oi+1];
        const pz = originalData.positions[oi+2];
        
        const closest = findClosestPoint(px, py, pz, result.positions, result.indices, result.faceCount);
        const error = Math.hypot(closest.x - px, closest.y - py, closest.z - pz);
        
        maxError = Math.max(maxError, error);
        totalError += error;
    }
    
    return (maxError / bboxSize) * 100;
}

function findClosestPoint(px, py, pz, positions, indices, faceCount) {
    let minDist = Infinity;
    let closest = { x: px, y: py, z: pz };
    
    const sampleFaces = Math.min(faceCount, 1000);
    for (let i = 0; i < sampleFaces; i++) {
        const fi = Math.floor(Math.random() * faceCount);
        const i0 = indices[fi*3] * 3;
        const i1 = indices[fi*3+1] * 3;
        const i2 = indices[fi*3+2] * 3;
        
        const v0x = positions[i0], v0y = positions[i0+1], v0z = positions[i0+2];
        const v1x = positions[i1], v1y = positions[i1+1], v1z = positions[i1+2];
        const v2x = positions[i2], v2y = positions[i2+1], v2z = positions[i2+2];
        
        const point = closestPointOnTriangle(px, py, pz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z);
        const dist = Math.hypot(point.x - px, point.y - py, point.z - pz);
        
        if (dist < minDist) {
            minDist = dist;
            closest = point;
        }
    }
    
    return closest;
}

function closestPointOnTriangle(px, py, pz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z) {
    const abx = v1x - v0x, aby = v1y - v0y, abz = v1z - v0z;
    const acx = v2x - v0x, acy = v2y - v0y, acz = v2z - v0z;
    const apx = px - v0x, apy = py - v0y, apz = pz - v0z;
    
    const d1 = abx*apx + aby*apy + abz*apz;
    const d2 = acx*apx + acy*apy + acz*apz;
    
    if (d1 <= 0 && d2 <= 0) return { x: v0x, y: v0y, z: v0z };
    
    const bpx = px - v1x, bpy = py - v1y, bpz = pz - v1z;
    const d3 = abx*bpx + aby*bpy + abz*bpz;
    const d4 = acx*bpx + acy*bpy + acz*bpz;
    
    if (d3 >= 0 && d4 <= d3) return { x: v1x, y: v1y, z: v1z };
    
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return { x: v0x + v * abx, y: v0y + v * aby, z: v0z + v * abz };
    }
    
    const cpx = px - v2x, cpy = py - v2y, cpz = pz - v2z;
    const d5 = abx*cpx + aby*cpy + abz*cpz;
    const d6 = acx*cpx + acy*cpy + acz*cpz;
    
    if (d6 >= 0 && d5 <= d6) return { x: v2x, y: v2y, z: v2z };
    
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return { x: v0x + w * acx, y: v0y + w * acy, z: v0z + w * acz };
    }
    
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return { x: v1x + w * (v2x - v1x), y: v1y + w * (v2y - v1y), z: v1z + w * (v2z - v1z) };
    }
    
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    
    return {
        x: v0x + v * abx + w * acx,
        y: v0y + v * aby + w * acy,
        z: v0z + v * abz + w * acz
    };
}

function findClosestPointWithBarycentric(px, py, pz, positions, indices, uvs, faceCount) {
    let minDist = Infinity;
    let result = { x: px, y: py, z: pz, u: 0, v: 0, faceIndex: -1 };
    
    const sampleFaces = Math.min(faceCount, 1000);
    for (let i = 0; i < sampleFaces; i++) {
        const fi = Math.floor(Math.random() * faceCount);
        const vi0 = indices[fi*3];
        const vi1 = indices[fi*3+1];
        const vi2 = indices[fi*3+2];
        const i0 = vi0 * 3;
        const i1 = vi1 * 3;
        const i2 = vi2 * 3;
        
        const v0x = positions[i0], v0y = positions[i0+1], v0z = positions[i0+2];
        const v1x = positions[i1], v1y = positions[i1+1], v1z = positions[i1+2];
        const v2x = positions[i2], v2y = positions[i2+1], v2z = positions[i2+2];
        
        const point = barycentricClosestPointOnTriangle(px, py, pz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z);
        const dist = Math.hypot(point.x - px, point.y - py, point.z - pz);
        
        if (dist < minDist) {
            minDist = dist;
            result.x = point.x;
            result.y = point.y;
            result.z = point.z;
            
            if (uvs) {
                const u0 = uvs[vi0*2], v0uv = uvs[vi0*2+1];
                const u1 = uvs[vi1*2], v1uv = uvs[vi1*2+1];
                const u2 = uvs[vi2*2], v2uv = uvs[vi2*2+1];
                const w = point.baryW;
                const u = point.baryU;
                const v = point.baryV;
                result.u = w * u0 + u * u1 + v * u2;
                result.v = w * v0uv + u * v1uv + v * v2uv;
            }
            result.faceIndex = fi;
        }
    }
    
    return result;
}

function barycentricClosestPointOnTriangle(px, py, pz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z) {
    const abx = v1x - v0x, aby = v1y - v0y, abz = v1z - v0z;
    const acx = v2x - v0x, acy = v2y - v0y, acz = v2z - v0z;
    const apx = px - v0x, apy = py - v0y, apz = pz - v0z;
    
    const d1 = abx*apx + aby*apy + abz*apz;
    const d2 = acx*apx + acy*apy + acz*apz;
    
    if (d1 <= 0 && d2 <= 0) return { x: v0x, y: v0y, z: v0z, baryW: 1, baryU: 0, baryV: 0 };
    
    const bpx = px - v1x, bpy = py - v1y, bpz = pz - v1z;
    const d3 = abx*bpx + aby*bpy + abz*bpz;
    const d4 = acx*bpx + acy*bpy + acz*bpz;
    
    if (d3 >= 0 && d4 <= d3) return { x: v1x, y: v1y, z: v1z, baryW: 0, baryU: 1, baryV: 0 };
    
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return { 
            x: v0x + v * abx, y: v0y + v * aby, z: v0z + v * abz,
            baryW: 1 - v, baryU: v, baryV: 0
        };
    }
    
    const cpx = px - v2x, cpy = py - v2y, cpz = pz - v2z;
    const d5 = abx*cpx + aby*cpy + abz*cpz;
    const d6 = acx*cpx + acy*cpy + acz*cpz;
    
    if (d6 >= 0 && d5 <= d6) return { x: v2x, y: v2y, z: v2z, baryW: 0, baryU: 0, baryV: 1 };
    
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return { 
            x: v0x + w * acx, y: v0y + w * acy, z: v0z + w * acz,
            baryW: 1 - w, baryU: 0, baryV: w
        };
    }
    
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return { 
            x: v1x + w * (v2x - v1x), y: v1y + w * (v2y - v1y), z: v1z + w * (v2z - v1z),
            baryW: 0, baryU: 1 - w, baryV: w
        };
    }
    
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    
    return {
        x: v0x + v * abx + w * acx,
        y: v0y + v * aby + w * acy,
        z: v0z + v * abz + w * acz,
        baryW: 1 - v - w,
        baryU: v,
        baryV: w
    };
}

function computeTextureError(originalData, result) {
    if (!originalData.uvs || !result.uvs) return 0;
    
    const sampleCount = Math.min(100, result.faceCount);
    let maxStretchError = 0;
    let totalStretch = 0;
    let validCount = 0;
    
    const textureSize = 1024;
    
    for (let si = 0; si < sampleCount; si++) {
        const fi = Math.floor(si * result.faceCount / sampleCount);
        
        const ri0 = result.indices[fi*3];
        const ri1 = result.indices[fi*3+1];
        const ri2 = result.indices[fi*3+2];
        
        const rp0x = result.positions[ri0*3], rp0y = result.positions[ri0*3+1], rp0z = result.positions[ri0*3+2];
        const rp1x = result.positions[ri1*3], rp1y = result.positions[ri1*3+1], rp1z = result.positions[ri1*3+2];
        const rp2x = result.positions[ri2*3], rp2y = result.positions[ri2*3+1], rp2z = result.positions[ri2*3+2];
        
        const ru0 = result.uvs[ri0*2], rv0 = result.uvs[ri0*2+1];
        const ru1 = result.uvs[ri1*2], rv1 = result.uvs[ri1*2+1];
        const ru2 = result.uvs[ri2*2], rv2 = result.uvs[ri2*2+1];
        
        const rABx = rp1x - rp0x, rABy = rp1y - rp0y, rABz = rp1z - rp0z;
        const rACx = rp2x - rp0x, rACy = rp2y - rp0y, rACz = rp2z - rp0z;
        const rAreaGeo = Math.sqrt(
            (rABy*rACz - rABz*rACy)**2 +
            (rABz*rACx - rABx*rACz)**2 +
            (rABx*rACy - rABy*rACx)**2
        );
        
        const rAreaUV = Math.abs((ru1 - ru0) * (rv2 - rv0) - (ru2 - ru0) * (rv1 - rv0));
        
        if (rAreaGeo < 1e-12 || rAreaUV < 1e-12) continue;
        
        const rDenom = rAreaGeo * textureSize * textureSize;
        if (rDenom < 1e-12) continue;
        const rStretch = Math.sqrt(rAreaUV / rAreaGeo) * textureSize;
        
        const cx = (rp0x + rp1x + rp2x) / 3;
        const cy = (rp0y + rp1y + rp2y) / 3;
        const cz = (rp0z + rp1z + rp2z) / 3;
        
        const origStretch = estimateOriginalStretch(originalData, cx, cy, cz, textureSize);
        if (origStretch <= 0) continue;
        
        const ratio = rStretch / origStretch;
        const stretchError = Math.abs(Math.log2(Math.max(0.1, Math.min(10, ratio)))) * 2;
        
        if (isFinite(stretchError)) {
            maxStretchError = Math.max(maxStretchError, stretchError);
            totalStretch += stretchError;
            validCount++;
        }
    }
    
    return maxStretchError;
}

function estimateOriginalStretch(originalData, cx, cy, cz, textureSize) {
    const sampleFaces = Math.min(50, originalData.indexCount / 3);
    let bestAreaGeo = 0, bestAreaUV = 0;
    let minDist = Infinity;
    
    const fc = originalData.indexCount / 3;
    
    for (let i = 0; i < sampleFaces; i++) {
        const fi = Math.floor(Math.random() * fc);
        const vi0 = originalData.indices[fi*3];
        const vi1 = originalData.indices[fi*3+1];
        const vi2 = originalData.indices[fi*3+2];
        
        const p0x = originalData.positions[vi0*3], p0y = originalData.positions[vi0*3+1], p0z = originalData.positions[vi0*3+2];
        const p1x = originalData.positions[vi1*3], p1y = originalData.positions[vi1*3+1], p1z = originalData.positions[vi1*3+2];
        const p2x = originalData.positions[vi2*3], p2y = originalData.positions[vi2*3+1], p2z = originalData.positions[vi2*3+2];
        
        const cfx = (p0x + p1x + p2x) / 3;
        const cfy = (p0y + p1y + p2y) / 3;
        const cfz = (p0z + p1z + p2z) / 3;
        const dist = Math.hypot(cfx-cx, cfy-cy, cfz-cz);
        
        if (dist < minDist) {
            minDist = dist;
            const abx = p1x - p0x, aby = p1y - p0y, abz = p1z - p0z;
            const acx = p2x - p0x, acy = p2y - p0y, acz = p2z - p0z;
            bestAreaGeo = Math.sqrt(
                (aby*acz - abz*acy)**2 +
                (abz*acx - abx*acz)**2 +
                (abx*acy - aby*acx)**2
            );
            
            const u0 = originalData.uvs[vi0*2], v0uv = originalData.uvs[vi0*2+1];
            const u1 = originalData.uvs[vi1*2], v1uv = originalData.uvs[vi1*2+1];
            const u2 = originalData.uvs[vi2*2], v2uv = originalData.uvs[vi2*2+1];
            bestAreaUV = Math.abs((u1 - u0) * (v2uv - v0uv) - (u2 - u0) * (v1uv - v0uv));
        }
    }
    
    if (bestAreaGeo < 1e-12 || bestAreaUV < 1e-12) return 0;
    return Math.sqrt(bestAreaUV / bestAreaGeo) * textureSize;
}

// ----------------------------------------------------------------------------
// 创建减面后的网格
// ----------------------------------------------------------------------------
function createDecimatedMesh(result) {
    if (State.decimatedMesh) {
        State.scene.remove(State.decimatedMesh);
        State.decimatedMesh.geometry.dispose();
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
    if (result.uvs) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(result.uvs, 2));
    }
    geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
    
    State.decimatedGeometry = geometry;
    
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.6,
        side: THREE.DoubleSide
    });
    
    if (State.textures.length > 0) {
        material.map = State.textures[0];
    }
    
    State.decimatedMesh = new THREE.Mesh(geometry, material);
    State.decimatedMesh.castShadow = true;
    State.decimatedMesh.receiveShadow = true;
    State.scene.add(State.decimatedMesh);
}

// ----------------------------------------------------------------------------
// 误差可视化
// ----------------------------------------------------------------------------
function updateErrorOverlay() {
    if (!State.decimatedMesh || !State.originalMesh) return;
    
    const ctx = State.errorOverlayCtx;
    const canvas = State.errorOverlayCanvas;
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    const threshold = State.params.errorThreshold / 100 * State.bboxDiagonal;
    
    const sampleStep = 8;
    const halfStep = sampleStep / 2;
    
    for (let y = 0; y < height; y += sampleStep) {
        for (let x = 0; x < width; x += sampleStep) {
            State.mouse.x = (x / width) * 2 - 1;
            State.mouse.y = -(y / height) * 2 + 1;
            
            State.raycaster.setFromCamera(State.mouse, State.camera);
            
            const intersects = State.raycaster.intersectObjects([State.decimatedMesh], false);
            
            if (intersects.length > 0) {
                const point = intersects[0].point;
                
                const closest = findClosestPoint(
                    point.x, point.y, point.z,
                    State.originalData.positions,
                    State.originalData.indices,
                    State.stats.originalFaces
                );
                
                const error = Math.hypot(closest.x - point.x, closest.y - point.y, closest.z - point.z);
                const normalizedError = error / State.bboxDiagonal;
                
                const errorPercent = normalizedError * 100;
                const thresholdPercent = State.params.errorThreshold;
                
                let color;
                if (errorPercent >= thresholdPercent) {
                    color = 'rgba(239, 68, 68, 0.8)';
                } else if (errorPercent >= thresholdPercent * 0.5) {
                    color = 'rgba(234, 179, 8, 0.6)';
                } else {
                    color = 'rgba(34, 197, 94, 0.3)';
                }
                
                ctx.fillStyle = color;
                ctx.fillRect(x - halfStep, y - halfStep, sampleStep, sampleStep);
            }
        }
    }
}

// ----------------------------------------------------------------------------
// UI交互函数
// ----------------------------------------------------------------------------
function toggleOriginal() {
    State.showOriginal = document.getElementById('show-original').checked;
    if (State.originalMesh) {
        State.originalMesh.visible = State.showOriginal;
    }
}

function toggleDecimated() {
    State.showDecimated = document.getElementById('show-decimated').checked;
    if (State.decimatedMesh) {
        State.decimatedMesh.visible = State.showDecimated;
    }
}

function toggleErrorOverlay() {
    State.showErrorOverlay = document.getElementById('show-error').checked;
    State.errorOverlayCanvas.style.display = State.showErrorOverlay ? 'block' : 'none';
}

function showLoading(text) {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('loading-text').textContent = text;
    document.getElementById('decimate-btn').disabled = true;
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('decimate-btn').disabled = !State.originalMesh;
}

function updateProgress(percent, text) {
    document.getElementById('progress-fill').style.width = percent + '%';
    if (text) {
        updateStatus(text);
    }
}

function updateStatus(text) {
    document.getElementById('status-text').textContent = text;
}

function updateOriginalStats() {
    document.getElementById('orig-faces').textContent = Math.round(State.stats.originalFaces).toLocaleString();
    document.getElementById('orig-verts').textContent = Math.round(State.stats.originalVertices).toLocaleString();
    document.getElementById('orig-uvs').textContent = State.originalData.uvs ? '1' : '0';
    document.getElementById('orig-textures').textContent = State.textures.length;
    
    if (State.boundingBox) {
        const size = new THREE.Vector3();
        State.boundingBox.getSize(size);
        document.getElementById('orig-bbox').textContent = 
            `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
    }
}

function updateResultStats() {
    document.getElementById('res-faces').textContent = Math.round(State.stats.decimatedFaces).toLocaleString();
    
    const ratio = State.stats.originalFaces / State.stats.decimatedFaces;
    document.getElementById('res-ratio').textContent = ratio.toFixed(1) + '×';
    
    document.getElementById('res-time').textContent = State.stats.executionTime.toFixed(2) + ' ms';
    document.getElementById('res-memory').textContent = State.stats.memoryDelta.toFixed(2) + ' MB';
    document.getElementById('res-geo-error').textContent = State.stats.geoError.toFixed(4) + '%';
    document.getElementById('res-tex-error').textContent = State.stats.texError.toFixed(2) + ' px';
}

function updatePerformanceMetrics() {
    const timePass = State.stats.executionTime <= 2000;
    const memoryPass = State.stats.memoryDelta <= 200;
    const texturePass = State.stats.texError <= State.params.textureErrorThreshold;
    const facesPass = State.stats.decimatedFaces <= 50000;
    
    const timeEl = document.getElementById('perf-time');
    const memEl = document.getElementById('perf-memory');
    const texEl = document.getElementById('perf-texture');
    const faceEl = document.getElementById('perf-faces');
    
    timeEl.textContent = State.stats.executionTime.toFixed(0) + ' ms';
    timeEl.className = timePass ? 'metric-pass' : 'metric-fail';
    timeEl.textContent += timePass ? ' ✓' : ' ✗';
    
    memEl.textContent = State.stats.memoryDelta.toFixed(1) + ' MB';
    memEl.className = memoryPass ? 'metric-pass' : 'metric-fail';
    memEl.textContent += memoryPass ? ' ✓' : ' ✗';
    
    texEl.textContent = State.stats.texError.toFixed(2) + ' px';
    texEl.className = texturePass ? 'metric-pass' : 'metric-fail';
    texEl.textContent += texturePass ? ' ✓' : ' ✗';
    
    faceEl.textContent = Math.round(State.stats.decimatedFaces).toLocaleString();
    faceEl.className = facesPass ? 'metric-pass' : 'metric-fail';
    faceEl.textContent += facesPass ? ' ✓' : ' ✗';
}

function exportModel() {
    if (!State.decimatedGeometry) {
        alert('请先执行减面操作');
        return;
    }
    
    const data = {
        positions: Array.from(State.decimatedGeometry.getAttribute('position').array),
        normals: Array.from(State.decimatedGeometry.getAttribute('normal').array),
        indices: Array.from(State.decimatedGeometry.getIndex().array)
    };
    
    if (State.decimatedGeometry.getAttribute('uv')) {
        data.uvs = Array.from(State.decimatedGeometry.getAttribute('uv').array);
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decimated_model.json';
    a.click();
    URL.revokeObjectURL(url);
}

function resetScene() {
    if (State.originalMesh) {
        State.scene.remove(State.originalMesh);
        State.originalMesh.geometry.dispose();
        State.originalMesh = null;
    }
    if (State.decimatedMesh) {
        State.scene.remove(State.decimatedMesh);
        State.decimatedMesh.geometry.dispose();
        State.decimatedMesh = null;
    }
    
    State.originalGeometry = null;
    State.decimatedGeometry = null;
    State.originalData = null;
    State.textures = [];
    State.boundingBox = null;
    State.boundingSphere = null;
    
    State.stats = {
        originalFaces: 0,
        originalVertices: 0,
        decimatedFaces: 0,
        decimatedVertices: 0,
        executionTime: 0,
        memoryDelta: 0,
        geoError: 0,
        texError: 0,
        memoryBaseline: 0
    };
    
    document.getElementById('orig-faces').textContent = '-';
    document.getElementById('orig-verts').textContent = '-';
    document.getElementById('orig-uvs').textContent = '-';
    document.getElementById('orig-textures').textContent = '-';
    document.getElementById('orig-bbox').textContent = '-';
    
    document.getElementById('res-faces').textContent = '-';
    document.getElementById('res-ratio').textContent = '-';
    document.getElementById('res-time').textContent = '-';
    document.getElementById('res-memory').textContent = '-';
    document.getElementById('res-geo-error').textContent = '-';
    document.getElementById('res-tex-error').textContent = '-';
    
    document.getElementById('perf-time').textContent = '-';
    document.getElementById('perf-memory').textContent = '-';
    document.getElementById('perf-texture').textContent = '-';
    document.getElementById('perf-faces').textContent = '-';
    
    document.getElementById('perf-time').className = '';
    document.getElementById('perf-memory').className = '';
    document.getElementById('perf-texture').className = '';
    document.getElementById('perf-faces').className = '';
    
    document.getElementById('decimate-btn').disabled = true;
    document.getElementById('progress-fill').style.width = '0%';
    updateStatus('等待模型加载...');
    
    State.errorOverlayCtx.clearRect(0, 0, 
        State.errorOverlayCanvas.width, 
        State.errorOverlayCanvas.height);
    
    State.camera.position.set(5, 3, 5);
    State.controls.target.set(0, 0, 0);
    State.controls.update();
}

// ----------------------------------------------------------------------------
// 滑块值更新
// ----------------------------------------------------------------------------
document.getElementById('target-faces').addEventListener('input', function() {
    document.getElementById('target-faces-value').textContent = this.value;
});

document.getElementById('hard-angle').addEventListener('input', function() {
    document.getElementById('hard-angle-value').textContent = this.value;
});

document.getElementById('uv-seam').addEventListener('input', function() {
    document.getElementById('uv-seam-value').textContent = this.value;
});

document.getElementById('texture-error').addEventListener('input', function() {
    document.getElementById('texture-error-value').textContent = this.value;
});

document.getElementById('error-threshold').addEventListener('input', function() {
    document.getElementById('error-threshold-value').textContent = this.value;
    State.params.errorThreshold = parseFloat(this.value);
});

// ----------------------------------------------------------------------------
// 初始化
// ----------------------------------------------------------------------------
function tryInit() {
    if (THREE.OrbitControls && THREE.OBJLoader && THREE.GLTFLoader) {
        initThreeJS();
        console.log('⚡ 实时高模减面工具已初始化');
        console.log('功能: QSlim边折叠算法 | 硬边保护 | UV接缝保护 | 纹理误差控制 | 误差可视化');
    } else {
        setTimeout(tryInit, 100);
    }
}

window.addEventListener('DOMContentLoaded', function() {
    tryInit();
});