const fs = require('fs');
const vm = require('vm');

const appCode = fs.readFileSync('app.js', 'utf8');

const sandbox = {
    console: console,
    window: {
        addEventListener: () => {},
        __modulesLoaded: true
    },
    THREE: {
        Raycaster: function() {},
        Vector2: function() {},
        Vector3: function() {},
        Color: function() {},
        Scene: function() {},
        PerspectiveCamera: function() { this.position = { set: () => {} }; },
        WebGLRenderer: function() { 
            this.domElement = {}; 
            this.setSize = () => {};
            this.setPixelRatio = () => {};
            this.shadowMap = { enabled: false, type: 0 };
        },
        PCFSoftShadowMap: 1,
        DirectionalLight: function() { this.position = { set: () => {} }; this.castShadow = false; },
        AmbientLight: function() {},
        Mesh: function() { this.material = {}; this.castShadow = false; this.receiveShadow = false; },
        MeshPhongMaterial: function() {},
        BufferGeometry: function() {
            this.attributes = {};
            this.index = null;
            this.computeVertexNormals = () => {};
            this.computeBoundingBox = () => {};
            this.computeBoundingSphere = () => {};
            this.boundingBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
            this.boundingSphere = { radius: 1 };
            this.setAttribute = function(name, attr) {
                this.attributes[name] = attr;
            };
            this.setIndex = function(attr) {
                this.index = attr;
            };
            this.getAttribute = function(name) {
                return this.attributes[name];
            };
            this.dispose = () => {};
        },
        BufferAttribute: function(arr, size) {
            this.array = arr;
            this.itemSize = size;
            this.count = arr.length / size;
        },
        FrontSide: 0,
        DoubleSide: 1,
        NormalBlending: 0,
        AdditiveBlending: 1
    },
    document: {
        getElementById: () => ({
            getContext: () => ({}),
            addEventListener: () => {},
            style: {},
            classList: { add: () => {}, remove: () => {} },
            value: '',
            textContent: '',
            innerHTML: '',
            appendChild: () => {},
            files: [],
            createElement: () => ({
                getContext: () => ({}),
                addEventListener: () => {},
                style: {},
                classList: { add: () => {}, remove: () => {} },
                value: '',
                textContent: '',
                innerHTML: '',
                appendChild: () => {},
                files: [],
                createElement: () => ({})
            })
        }),
        createElement: () => ({
            getContext: () => ({}),
            addEventListener: () => {},
            style: {},
            classList: { add: () => {}, remove: () => {} },
            value: '',
            textContent: '',
            innerHTML: '',
            appendChild: () => {},
            files: [],
            createElement: () => ({})
        })
    },
    performance: { now: () => Date.now() },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    URL: { createObjectURL: () => 'blob:test' },
    FileReader: function() {
        this.onload = null;
        this.readAsDataURL = () => {};
        this.readAsArrayBuffer = () => {};
        this.result = null;
    }
};
vm.createContext(sandbox);

try {
    vm.runInContext(appCode, sandbox);
    console.log('app.js 加载成功');
    
    const testFaces = 100;
    console.log('\n测试 generateHighPolyModel (目标' + testFaces + '面)...');
    const geometry = sandbox.generateHighPolyModel(testFaces);
    const positions = geometry.attributes.position.array;
    const normals = geometry.attributes.normal.array;
    const uvs = geometry.attributes.uv.array;
    const indices = geometry.index.array;
    const vertexCount = positions.length / 3;
    const faceCount = indices.length / 3;
    console.log('原始模型: ' + vertexCount + ' 顶点, ' + faceCount + ' 面');
    
    console.log('\n测试 decimateMesh (目标100面)...');
    const params = {
        targetFaces: 100,
        hardEdgeAngle: 60,
        uvSeamWeight: 1.0,
        textureErrorThreshold: 2,
        preserveBorders: true,
        errorThreshold: 0.1
    };
    
    const data = {
        positions: positions,
        normals: normals,
        uvs: uvs,
        indices: indices,
        vertexCount: vertexCount,
        indexCount: indices.length
    };
    
    const startTime = Date.now();
    const result = sandbox.decimateMesh(data, params);
    const endTime = Date.now();
    
    console.log('减面结果:');
    console.log('  顶点数: ' + result.vertexCount);
    console.log('  面数: ' + result.faceCount);
    console.log('  耗时: ' + (endTime - startTime) + 'ms');
    console.log('  几何误差: ' + result.geoError);
    console.log('  纹理误差: ' + result.texError);
    
    const resultFaceCount = result.indices.length / 3;
    console.log('\n验证:');
    console.log('  实际面数(indices/3): ' + resultFaceCount);
    console.log('  声明的面数: ' + result.faceCount);
    console.log('  是否匹配: ' + (resultFaceCount === result.faceCount));
    
    let degenerateFaces = 0;
    let negativeIndices = 0;
    let outOfBounds = 0;
    for (let i = 0; i < resultFaceCount; i++) {
        const i0 = result.indices[i*3];
        const i1 = result.indices[i*3+1];
        const i2 = result.indices[i*3+2];
        
        if (i0 < 0 || i1 < 0 || i2 < 0) {
            negativeIndices++;
        }
        if (i0 === i1 || i1 === i2 || i2 === i0) {
            degenerateFaces++;
        }
        if (i0 >= result.vertexCount || i1 >= result.vertexCount || i2 >= result.vertexCount) {
            outOfBounds++;
        }
    }
    console.log('  退化面: ' + degenerateFaces);
    console.log('  负索引面: ' + negativeIndices);
    console.log('  索引越界面: ' + outOfBounds);
    console.log('  有效面: ' + (resultFaceCount - degenerateFaces - negativeIndices - outOfBounds));
    
} catch (e) {
    console.error('错误:', e.message);
    console.error(e.stack);
}
