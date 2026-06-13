import { TextureCache } from './TextureCache';
import { 
  VERTEX_SHADER, 
  FRAGMENT_SHADER_FILTERS, 
  FRAGMENT_SHADER_BLEND,
  blendModeToInt 
} from './shaders';
import type { Layer, BlendMode, FilterConfig } from '@/types';

interface ProgramInfo {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  attribs: Record<string, number>;
}

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private textureCache: TextureCache;
  private programs: Map<string, ProgramInfo> = new Map();
  private quadBuffer: WebGLBuffer | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private framebufferTexture: WebGLTexture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { 
      antialias: true, 
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    
    this.gl = gl;
    this.textureCache = new TextureCache(gl, { maxMemoryMB: 1024 });
    
    this.initBuffers();
    this.initPrograms();
    this.initFramebuffer();
  }

  private initBuffers(): void {
    const gl = this.gl;
    
    const positions = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]);
    
    const texCoords = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]);
    
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
  }

  private initPrograms(): void {
    this.createProgram('main', VERTEX_SHADER, FRAGMENT_SHADER_FILTERS);
    this.createProgram('blend', VERTEX_SHADER, FRAGMENT_SHADER_BLEND);
  }

  private createProgram(name: string, vertexSource: string, fragmentSource: string): void {
    const gl = this.gl;
    
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
      const info = gl.getActiveUniform(program, i)!;
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    
    const attribs: Record<string, number> = {};
    const attribCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < attribCount; i++) {
      const info = gl.getActiveAttrib(program, i)!;
      attribs[info.name] = gl.getAttribLocation(program, info.name);
    }
    
    this.programs.set(name, { program, uniforms, attribs });
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    }
    
    return shader;
  }

  private initFramebuffer(): void {
    const gl = this.gl;
    
    this.framebuffer = gl.createFramebuffer();
    this.framebufferTexture = gl.createTexture();
    
    gl.bindTexture(gl.TEXTURE_2D, this.framebufferTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.canvas.width,
      this.canvas.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  public resize(width: number, height: number): void {
    const gl = this.gl;
    const pixelRatio = window.devicePixelRatio || 1;
    
    this.canvas.width = width * pixelRatio;
    this.canvas.height = height * pixelRatio;
    
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    if (this.framebufferTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.framebufferTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        this.canvas.width,
        this.canvas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
    }
  }

  public createTexture(
    image: HTMLImageElement | ImageData | HTMLCanvasElement
  ): { id: string; texture: WebGLTexture; width: number; height: number } {
    return this.textureCache.createTexture(image);
  }

  public updateTexture(id: string, image: HTMLImageElement | ImageData | HTMLCanvasElement): void {
    this.textureCache.updateTexture(id, image);
  }

  public deleteTexture(id: string): void {
    this.textureCache.deleteTexture(id);
  }

  public render(
    layers: Layer[],
    viewport: { x: number; y: number; width: number; height: number; zoom: number },
    backgroundColor: string
  ): void {
    const gl = this.gl;
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    const bgColor = this.hexToRgb(backgroundColor);
    gl.clearColor(bgColor.r / 255, bgColor.g / 255, bgColor.b / 255, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    
    const visibleLayers = layers.filter(l => l.style.visible);
    
    for (const layer of visibleLayers) {
      this.renderLayer(layer, viewport);
    }
    
    gl.disable(gl.BLEND);
  }

  private renderLayer(layer: Layer, viewport: { x: number; y: number; width: number; height: number; zoom: number }): void {
    const gl = this.gl;
    const programInfo = this.programs.get('main');
    if (!programInfo) return;
    
    if (layer.type !== 'image' || !layer.textureId) return;
    
    const texture = this.textureCache.getTexture(layer.textureId);
    const texInfo = this.textureCache.getTextureInfo(layer.textureId);
    if (!texture || !texInfo) return;
    
    gl.useProgram(programInfo.program);
    
    const pixelRatio = window.devicePixelRatio || 1;
    const canvasWidth = this.canvas.width / pixelRatio;
    const canvasHeight = this.canvas.height / pixelRatio;
    
    const matrix = this.calculateTransformMatrix(layer, viewport, canvasWidth, canvasHeight);
    
    gl.uniformMatrix3fv(programInfo.uniforms.u_matrix, false, matrix);
    gl.uniform2f(programInfo.uniforms.u_resolution, this.canvas.width, this.canvas.height);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(programInfo.uniforms.u_image, 0);
    
    gl.uniform1f(programInfo.uniforms.u_opacity, layer.style.opacity);
    
    this.applyFilterUniforms(programInfo, layer.style.filters);
    
    const positionLoc = programInfo.attribs.a_position;
    const texCoordLoc = programInfo.attribs.a_texCoord;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private calculateTransformMatrix(
    layer: Layer,
    viewport: { x: number; y: number; width: number; height: number; zoom: number },
    canvasWidth: number,
    canvasHeight: number
  ): Float32Array {
    const { transform } = layer;
    
    const screenToCanvasX = canvasWidth / viewport.width;
    const screenToCanvasY = canvasHeight / viewport.height;
    
    const layerX = (transform.x - viewport.x) * viewport.zoom * screenToCanvasX + canvasWidth / 2;
    const layerY = (transform.y - viewport.y) * viewport.zoom * screenToCanvasY + canvasHeight / 2;
    const layerW = transform.width * transform.scaleX * viewport.zoom * screenToCanvasX;
    const layerH = transform.height * transform.scaleY * viewport.zoom * screenToCanvasY;
    
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    
    return new Float32Array([
      layerW * cos, -layerH * sin, 0,
      layerW * sin, layerH * cos, 0,
      layerX - layerW / 2 * cos - layerH / 2 * sin,
      layerY - layerW / 2 * sin + layerH / 2 * cos,
      1,
    ]);
  }

  private applyFilterUniforms(programInfo: ProgramInfo, filters: FilterConfig[]): void {
    const gl = this.gl;
    
    const getFilterValue = (type: string): number => {
      const filter = filters.find(f => f.type === type && f.enabled);
      return filter ? filter.value : 0;
    };
    
    const isFilterEnabled = (type: string): boolean => {
      return filters.some(f => f.type === type && f.enabled);
    };
    
    gl.uniform1f(programInfo.uniforms.u_brightness, getFilterValue('brightness') / 100);
    gl.uniform1f(programInfo.uniforms.u_contrast, getFilterValue('contrast') / 100);
    gl.uniform1f(programInfo.uniforms.u_saturation, getFilterValue('saturation') / 100);
    gl.uniform1f(programInfo.uniforms.u_hueRotate, getFilterValue('hue-rotate'));
    gl.uniform1f(programInfo.uniforms.u_blur, getFilterValue('blur'));
    gl.uniform1f(programInfo.uniforms.u_sharpen, getFilterValue('sharpen') / 100);
    gl.uniform1i(programInfo.uniforms.u_grayscale, isFilterEnabled('grayscale') ? 1 : 0);
    gl.uniform1i(programInfo.uniforms.u_sepia, isFilterEnabled('sepia') ? 1 : 0);
    gl.uniform1i(programInfo.uniforms.u_invert, isFilterEnabled('invert') ? 1 : 0);
  }

  public readPixels(x: number, y: number, width: number, height: number): Uint8ClampedArray {
    const gl = this.gl;
    const data = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  }

  public toDataURL(type: string = 'image/png', quality: number = 0.92): string {
    return this.canvas.toDataURL(type, quality);
  }

  public toBlob(type: string = 'image/png', quality: number = 0.92): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
        type,
        quality
      );
    });
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    } : { r: 255, g: 255, b: 255 };
  }

  public getTextureCacheStats(): { count: number; memoryMB: number; maxMemoryMB: number } {
    return this.textureCache.getStats();
  }

  public destroy(): void {
    this.textureCache.clear();
    if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
    if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    if (this.framebufferTexture) this.gl.deleteTexture(this.framebufferTexture);
    this.programs.forEach(p => this.gl.deleteProgram(p.program));
  }
}
