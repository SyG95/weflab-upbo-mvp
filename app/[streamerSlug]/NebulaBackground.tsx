"use client";

// 살아있는 배경 부품. 아이코 업보시트(/s/aiko)의 ShaderBackground 를 레퍼런스로 가져와
// 테마별 팔레트(uniform)를 받도록 개조한 것. 모든 테마가 자기 색의 "흐르는 빛"을 가진다.
// WebGL 미지원/실패 시 테마의 --page-bg 그라데이션이 그대로 보인다(자동 대체).
// 노트 줄무늬(--rule-line)는 캔버스 위 레이어로 얹어 장부 정체성을 유지한다.

import { useEffect, useRef, useState } from "react";
import type { NebulaPalette } from "../../lib/themes";

const DEFAULT_PALETTE: NebulaPalette = {
  base: ["#0c1130", "#131a45"],
  clouds: ["#4d6bf2", "#8c61f2", "#59a6f2"],
};

function hexToVec3(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const n = parseInt(value.length === 3 ? value.replace(/./g, (c) => c + c) : value, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader allocation failed");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) throw new Error("WebGL program allocation failed");

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "unknown program link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

export default function NebulaBackground({ palette }: { palette?: NebulaPalette }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const paletteKey = JSON.stringify(palette ?? DEFAULT_PALETTE);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const colors = (JSON.parse(paletteKey) as NebulaPalette) ?? DEFAULT_PALETTE;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      stencil: false,
    });

    if (!gl) {
      setWebglFailed(true);
      return;
    }

    const vertexSource = `
      attribute vec2 position;
      varying vec2 vUv;

      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision mediump float;

      varying vec2 vUv;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform vec3 uBase0;
      uniform vec3 uBase1;
      uniform vec3 uCloudA;
      uniform vec3 uCloudB;
      uniform vec3 uCloudC;

      float blob(vec2 point, vec2 center, float radius) {
        float distanceFromCenter = length(point - center);
        return smoothstep(radius, 0.0, distanceFromCenter);
      }

      void main() {
        vec2 uv = vUv;
        vec2 point = uv * 2.0 - 1.0;
        point.x *= uResolution.x / max(uResolution.y, 1.0);

        float time = uTime * 0.00012;
        float cloudA = blob(point, vec2(sin(time * 0.72) * 0.58 - 0.28, cos(time * 0.82) * 0.24), 1.10);
        float cloudB = blob(point, vec2(cos(time * 0.68) * 0.66 + 0.32, sin(time * 0.56) * 0.34 + 0.12), 0.90);
        float cloudC = blob(point, vec2(sin(time * 0.42) * 0.42, cos(time * 0.46) * 0.38 - 0.32), 0.76);
        float wave = sin((point.x * 2.5) + (point.y * 1.9) + time * 2.8) * 0.5 + 0.5;

        vec3 color = mix(uBase0, uBase1, uv.y * 0.50 + wave * 0.12);
        color = mix(color, uCloudA, cloudA * 0.22);
        color = mix(color, uCloudB, cloudB * 0.20);
        color = mix(color, uCloudC, cloudC * 0.12);

        gl_FragColor = vec4(color, 0.92);
      }
    `;

    let animationFrame = 0;

    try {
      const program = createProgram(gl, vertexSource, fragmentSource);
      const positionLocation = gl.getAttribLocation(program, "position");
      const resolutionLocation = gl.getUniformLocation(program, "uResolution");
      const timeLocation = gl.getUniformLocation(program, "uTime");
      const buffer = gl.createBuffer();

      if (!buffer || positionLocation < 0) throw new Error("WebGL buffer setup failed");

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );

      gl.useProgram(program);
      gl.uniform3fv(gl.getUniformLocation(program, "uBase0"), hexToVec3(colors.base[0]));
      gl.uniform3fv(gl.getUniformLocation(program, "uBase1"), hexToVec3(colors.base[1]));
      gl.uniform3fv(gl.getUniformLocation(program, "uCloudA"), hexToVec3(colors.clouds[0]));
      gl.uniform3fv(gl.getUniformLocation(program, "uCloudB"), hexToVec3(colors.clouds[1]));
      gl.uniform3fv(gl.getUniformLocation(program, "uCloudC"), hexToVec3(colors.clouds[2]));

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.floor(window.innerWidth * dpr));
        const height = Math.max(1, Math.floor(window.innerHeight * dpr));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
      };

      const render = (time: number) => {
        resize();
        gl.useProgram(program);
        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform1f(timeLocation, prefersReducedMotion ? 0 : time);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (!prefersReducedMotion) {
          animationFrame = window.requestAnimationFrame(render);
        }
      };

      window.addEventListener("resize", resize);
      render(0);

      return () => {
        window.removeEventListener("resize", resize);
        window.cancelAnimationFrame(animationFrame);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      };
    } catch {
      setWebglFailed(true);
      window.cancelAnimationFrame(animationFrame);
    }
  }, [paletteKey]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--page-bg, var(--paper))",
        }}
      />
      {!webglFailed ? (
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0.85,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(180deg, transparent, transparent 27px, var(--rule-line, transparent) 27px, var(--rule-line, transparent) 28px)",
        }}
      />
    </div>
  );
}
