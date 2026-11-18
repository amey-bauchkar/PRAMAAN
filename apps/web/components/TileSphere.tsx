'use client';

import React, { useEffect, useRef } from 'react';

/**
 * A sphere built from ~1,500 small tiles that tilt in a slow wave and follow the pointer a little.
 * Three.js is loaded on demand. It pauses off screen, renders one still frame for reduced motion,
 * and falls back to a plain gradient disc if WebGL is unavailable.
 */
export function TileSphere({ color = '#ff6a1f', light = '#ffffff', className = '', count = 900, maxDpr = 1.5 }: { color?: string; light?: string; className?: string; count?: number; maxDpr?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: () => void = () => {};

    (async () => {
      const THREE = await import('three');
      if (disposed) return;

      let renderer: import('three').WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        host.style.background = `radial-gradient(circle at 35% 30%, ${light}, ${color})`;
        host.style.borderRadius = '50%';
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      camera.position.set(0, 0, 5.2);

      scene.add(new THREE.HemisphereLight(new THREE.Color(light), new THREE.Color(color).multiplyScalar(0.55), 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.6);
      sun.position.set(2.5, 3.5, 4.5);
      scene.add(sun);

      const N = count;
      const geometry = new THREE.BoxGeometry(0.115, 0.115, 0.07);
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.42, metalness: 0.05 });
      const mesh = new THREE.InstancedMesh(geometry, material, N);
      const group = new THREE.Group();
      group.add(mesh);
      scene.add(group);

      const dummy = new THREE.Object3D();
      const baseQ: import('three').Quaternion[] = [];
      const pos: import('three').Vector3[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const th = golden * i;
        const p = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
        dummy.position.copy(p);
        dummy.lookAt(p.clone().multiplyScalar(2));
        baseQ.push(dummy.quaternion.clone());
        pos.push(p);
      }

      const zAxis = new THREE.Vector3(0, 0, 1);
      const spinQ = new THREE.Quaternion();
      const scale = new THREE.Vector3(1, 1, 1);
      const update = (t: number) => {
        for (let i = 0; i < N; i++) {
          const p = pos[i]!;
          spinQ.setFromAxisAngle(zAxis, i * 0.11 + Math.sin(t * 0.9 + p.y * 3 + p.x * 2) * 0.55);
          dummy.position.copy(p);
          dummy.quaternion.copy(baseQ[i]!).multiply(spinQ);
          dummy.scale.copy(scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      };

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(() => { resize(); if (reduced) draw(); });
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      let tx = 0, ty = 0, cx = 0, cy = 0, spin = 0.6;
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        ty = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / window.innerWidth)) * 1.2;
        tx = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / window.innerHeight)) * 0.9;
      };
      const draw = () => renderer.render(scene, camera);

      let running = false;
      let raf = 0;
      let last = performance.now();
      let lastWave = 0;
      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        spin += dt * 0.18;
        cx += (tx - cx) * 0.05;
        cy += (ty - cy) * 0.05;
        group.rotation.set(cx * 0.5 + 0.25, spin + cy, 0);
        // The tile wave is the costly part (one matrix per tile), so it runs at about 20 fps; rotation stays at full rate.
        if (now - lastWave > 50) { update(now / 1000); lastWave = now; }
        draw();
        if (running) raf = requestAnimationFrame(loop);
      };

      resize();
      update(0);
      group.rotation.set(0.25, spin, 0);
      draw();
      ro.observe(host);

      let io: IntersectionObserver | undefined;
      if (!reduced) {
        window.addEventListener('pointermove', onMove, { passive: true });
        io = new IntersectionObserver(([e]) => {
          const vis = !!e?.isIntersecting;
          if (vis && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
          else if (!vis) { running = false; cancelAnimationFrame(raf); }
        });
        io.observe(host);
      }

      cleanup = () => {
        running = false;
        cancelAnimationFrame(raf);
        io?.disconnect();
        ro.disconnect();
        window.removeEventListener('pointermove', onMove);
        geometry.dispose();
        material.dispose();
        mesh.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => { disposed = true; cleanup(); };
  }, [color, light, count, maxDpr]);

  return <div ref={hostRef} className={className} role="img" aria-label="Animated sphere of tiles" />;
}
