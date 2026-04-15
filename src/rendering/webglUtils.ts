/**
 * WebGL2 setup utilities for WavefrontWebGLCanvas.
 * Pure functions — no React, no component state.
 */

/**
 * Compile a GLSL shader and return it. Throws with the info log on failure.
 */
export function compileShader(
  gl: WebGL2RenderingContext,
  source: string,
  type: number,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader object.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown compile error.';
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

/**
 * Link a vertex + fragment shader into a program and collect all active
 * uniform locations into a flat Record<string, WebGLUniformLocation>.
 *
 * Throws with the info log if linking fails.
 */
export function createShaderProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation> } {
  const vert = compileShader(gl, vertSrc, gl.VERTEX_SHADER);
  const frag = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER);

  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create WebGL program.');

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown link error.';
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${log}`);
  }

  // Collect all active uniform locations.
  const uniforms: Record<string, WebGLUniformLocation> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    // Strip array suffix "[0]" for cleaner access (e.g., "u_foo" not "u_foo[0]")
    const name = info.name.endsWith('[0]') ? info.name.slice(0, -3) : info.name;
    const loc = gl.getUniformLocation(program, info.name);
    if (loc !== null) uniforms[name] = loc;
  }

  return { program, uniforms };
}

/**
 * Allocate a 2D RGBA32F texture of size texW × texH.
 * Uses NEAREST filtering and no mipmaps — suitable for texelFetch access.
 * Texture storage is allocated but not initialized.
 */
export function createFloat32Texture(
  gl: WebGL2RenderingContext,
  texW: number,
  texH: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create WebGL texture.');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA32F, texW, texH, 0,
    gl.RGBA, gl.FLOAT, null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * Create a VAO + VBO for a fullscreen quad covering NDC [-1,1]².
 * Two triangles, 6 vertices. The vertex attribute is bound at location 0 (aPosition).
 */
export function createFullscreenQuad(
  gl: WebGL2RenderingContext,
): { vao: WebGLVertexArrayObject; vbo: WebGLBuffer } {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  if (!vao || !vbo) throw new Error('Failed to create quad geometry.');

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return { vao, vbo };
}
