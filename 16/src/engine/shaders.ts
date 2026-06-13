export const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

uniform mat3 u_matrix;
uniform vec2 u_resolution;

out vec2 v_texCoord;

void main() {
  vec2 position = (u_matrix * vec3(a_position, 1.0)).xy;
  vec2 clipSpace = (position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
  v_texCoord = a_texCoord;
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_image;
uniform float u_opacity;
uniform int u_blendMode;
uniform vec4 u_tintColor;
uniform float u_tintIntensity;

void main() {
  vec4 color = texture(u_image, v_texCoord);
  
  if (u_tintIntensity > 0.0) {
    color.rgb = mix(color.rgb, u_tintColor.rgb, u_tintIntensity * u_tintColor.a);
  }
  
  color.a *= u_opacity;
  outColor = color;
}
`;

export const FRAGMENT_SHADER_FILTERS = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_image;
uniform float u_opacity;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hueRotate;
uniform float u_blur;
uniform float u_sharpen;
uniform int u_grayscale;
uniform int u_sepia;
uniform int u_invert;
uniform vec2 u_resolution;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 color = texture(u_image, v_texCoord);
  
  if (u_invert == 1) {
    color.rgb = 1.0 - color.rgb;
  }
  
  if (u_grayscale == 1) {
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = vec3(gray);
  }
  
  if (u_sepia == 1) {
    float r = color.r * 0.393 + color.g * 0.769 + color.b * 0.189;
    float g = color.r * 0.349 + color.g * 0.686 + color.b * 0.168;
    float b = color.r * 0.272 + color.g * 0.534 + color.b * 0.131;
    color.rgb = vec3(r, g, b);
  }
  
  if (u_brightness != 0.0) {
    color.rgb += u_brightness;
  }
  
  if (u_contrast != 0.0) {
    float factor = (259.0 * (u_contrast * 255.0 + 255.0)) / (255.0 * (259.0 - u_contrast * 255.0));
    color.rgb = factor * (color.rgb - 0.5) + 0.5;
  }
  
  if (u_saturation != 0.0) {
    vec3 hsv = rgb2hsv(color.rgb);
    hsv.y *= (1.0 + u_saturation);
    color.rgb = hsv2rgb(hsv);
  }
  
  if (u_hueRotate != 0.0) {
    vec3 hsv = rgb2hsv(color.rgb);
    hsv.x += u_hueRotate / 360.0;
    hsv.x = fract(hsv.x);
    color.rgb = hsv2rgb(hsv);
  }
  
  color.a *= u_opacity;
  outColor = clamp(color, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER_BLEND = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_base;
uniform sampler2D u_blend;
uniform int u_blendMode;
uniform float u_opacity;

void main() {
  vec4 base = texture(u_base, v_texCoord);
  vec4 blend = texture(u_blend, v_texCoord);
  
  blend.a *= u_opacity;
  
  vec3 result;
  
  switch (u_blendMode) {
    case 0:
      result = blend.rgb;
      break;
    case 1:
      result = base.rgb * blend.rgb;
      break;
    case 2:
      result = 1.0 - (1.0 - base.rgb) * (1.0 - blend.rgb);
      break;
    case 3:
      result = mix(
        2.0 * base.rgb * blend.rgb,
        1.0 - 2.0 * (1.0 - base.rgb) * (1.0 - blend.rgb),
        step(0.5, base.rgb)
      );
      break;
    case 4:
      result = min(base.rgb, blend.rgb);
      break;
    case 5:
      result = max(base.rgb, blend.rgb);
      break;
    case 6:
      result = base.rgb / (1.0 - blend.rgb + 0.001);
      break;
    case 7:
      result = 1.0 - (1.0 - base.rgb) / (blend.rgb + 0.001);
      break;
    case 8:
      result = mix(
        2.0 * base.rgb * blend.rgb,
        1.0 - 2.0 * (1.0 - base.rgb) * (1.0 - blend.rgb),
        step(0.5, blend.rgb)
      );
      break;
    case 9:
      result = mix(
        2.0 * base.rgb * blend.rgb + base.rgb * base.rgb * (1.0 - 2.0 * blend.rgb),
        sqrt(base.rgb) * (2.0 * blend.rgb - 1.0) + 2.0 * base.rgb * (1.0 - blend.rgb),
        step(0.5, blend.rgb)
      );
      break;
    case 10:
      result = abs(base.rgb - blend.rgb);
      break;
    case 11:
      result = base.rgb + blend.rgb - 2.0 * base.rgb * blend.rgb;
      break;
    default:
      result = blend.rgb;
  }
  
  outColor = vec4(
    result.rgb * blend.a + base.rgb * (1.0 - blend.a),
    base.a + blend.a * (1.0 - base.a)
  );
}
`;

export const blendModeToInt: Record<string, number> = {
  'normal': 0,
  'multiply': 1,
  'screen': 2,
  'overlay': 3,
  'darken': 4,
  'lighten': 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  'difference': 10,
  'exclusion': 11,
  'hue': 0,
  'saturation': 0,
  'color': 0,
  'luminosity': 0,
};
