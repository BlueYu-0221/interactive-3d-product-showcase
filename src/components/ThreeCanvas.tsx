import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// 注册 GSAP 插件（模块级注册一次即可，重复注册无副作用）。
gsap.registerPlugin(ScrollTrigger)

/**
 * ThreeCanvas（阶段二）
 * -----------------------------------------------------------------------------
 * 在阶段一的 WebGL 地基（Scene / Camera / Renderer / Resize / Cleanup）之上，
 * 使用「纯原生 Three.js」完成：
 *   1. GLTFLoader 加载真实耳机模型 headphone.glb，并自动居中 + 缩放。
 *   2. 从模型中抓取左右耳罩子物体，供 GSAP 拆解动画使用。
 *   3. 绑定基于窗口滚动的 GSAP ScrollTrigger timeline：
 *        - 前 50%：整机顺时针自转 180° 并沿 Z 轴靠近相机。
 *        - 后 50%：Apple 风格拆解，左右耳罩沿 X 轴向两侧推开。
 *   4. 组件卸载时销毁所有 ScrollTrigger 实例，防止多页面切换动画错乱。
 *
 * 严禁使用 react-three-fiber / drei，全部手写生命周期。
 * -----------------------------------------------------------------------------
 */

// =============================================================================
// ⬇⬇⬇ 【在这里替换耳罩名字】 ⬇⬇⬇
// 打开浏览器控制台，找到形如  Node Name: xxx  Type: Mesh  的 11 条日志，
// 把左 / 右耳罩对应的 name 直接复制粘贴到下面两个常量里即可。
// =============================================================================
const LEFT_EARCUP_REPLACE = 'Ear_piece_left_rubber'
const RIGHT_EARCUP_REPLACE = 'Ear_piece_right_rubber'
// =============================================================================

export default function ThreeCanvas() {
  // canvas DOM 引用：把 WebGLRenderer 直接绑定到真实 canvas，便于 CSS 精确控制。
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // ---------------------------------------------------------------------
    // 1. 视口尺寸对象（resize 时统一更新）
    // ---------------------------------------------------------------------
    const sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    }

    // ---------------------------------------------------------------------
    // 2. Scene / Camera / Lights（地基部分，与阶段一一致）
    // ---------------------------------------------------------------------
    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(
      45, // 视场角 (Field of View)
      sizes.width / sizes.height, // 宽高比 (Aspect Ratio)
      0.1, // 近裁剪面 (Near)
      100, // 远裁剪面 (Far)
    )
    camera.position.set(0, 0, 6)
    scene.add(camera)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.4)
    directionalLight.position.set(3, 4, 5)
    scene.add(directionalLight)

    // 补一盏侧后方光，让金属 / 塑料材质的高光更立体（可选）。
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.2)
    rimLight.position.set(-4, 2, -5)
    scene.add(rimLight)

    // ---------------------------------------------------------------------
    // 3. WebGLRenderer（渲染器，含性能优化）
    // ---------------------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true, // 硬件抗锯齿，边缘更平滑
      alpha: true, // 背景透明，透出底层 HTML 深色背景
      powerPreference: 'high-performance',
    })
    renderer.setSize(sizes.width, sizes.height)
    // 像素比最高夹紧到 2，避免高 DPR 屏幕（DPR=3/4）过度渲染拖垮 GPU。
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace

    // ---------------------------------------------------------------------
    // 3.5 时钟 + 自定义全息 ShaderMaterial（阶段三核心）
    //     clock 提供连续递增的秒数，驱动扫描线滚动。
    //     hologramMaterial 用手写 GLSL 实现「菲涅尔边缘发光 + 向上滚动扫描线」，
    //     并用 u_hologramProgress(0→1) 在「暗底」与「全息发光」之间做混合，
    //     由 GSAP 在第三屏平滑推动 progress，实现材质渐变切换效果。
    // ---------------------------------------------------------------------
    const clock = new THREE.Clock()

    // Vertex Shader：标准投影变换，同时把「法线」与「视线方向」传给片元着色器。
    // - vNormal：法线转到视图空间（normalMatrix），供菲涅尔计算。
    // - vViewPosition：从顶点指向相机的方向（视图空间下相机在原点，故取 -mvPosition.xyz）。
    const hologramVertexShader = /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `

    // Fragment Shader：菲涅尔边缘发光 + 向上滚动扫描线 + progress 混合。
    // - fresnel：法线与视线越垂直（边缘）值越大，形成描边发光。
    // - scanline：用 vViewPosition.y 叠加 u_time 生成正弦条纹，向上滚动。
    // - u_hologramProgress：整体强度与透明度的开关，0=几乎不可见，1=全息全开。
    const hologramFragmentShader = /* glsl */ `
      uniform float u_time;
      uniform float u_hologramProgress;
      uniform vec3 u_glowColor;

      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        // 归一化法线与视线方向
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        // --- 菲涅尔效应：边缘越强，正对相机越弱 ---
        float fresnel = 1.0 - clamp(dot(normal, viewDir), 0.0, 1.0);
        fresnel = pow(fresnel, 2.5);

        // --- 向上滚动的扫描线：sin 条纹随 u_time 位移 ---
        float scan = sin(vViewPosition.y * 30.0 - u_time * 4.0) * 0.5 + 0.5;
        scan = pow(scan, 2.0) * 0.6;

        // --- 合成发光强度：菲涅尔描边 + 扫描线，受 progress 控制整体亮度 ---
        float glow = (fresnel + scan) * u_hologramProgress;

        vec3 color = u_glowColor * glow;
        // alpha 也随 progress 与发光强度联动，实现从透明渐显到全息发光。
        float alpha = clamp(glow, 0.0, 1.0) * u_hologramProgress;

        gl_FragColor = vec4(color, alpha);
      }
    `

    const hologramMaterial = new THREE.ShaderMaterial({
      uniforms: {
        u_time: { value: 0 },
        u_hologramProgress: { value: 0 },
        u_glowColor: { value: new THREE.Color(0.0, 0.8, 1.0) }, // 科技感亮蓝色
      },
      vertexShader: hologramVertexShader,
      fragmentShader: hologramFragmentShader,
      transparent: true, // 允许 alpha 混合，透出底层背景
      blending: THREE.AdditiveBlending, // 叠加混合，发光更通透
      depthWrite: false, // 关闭深度写入，避免半透明自遮挡产生黑边
    })

    // ---------------------------------------------------------------------
    // 4. 加载 GLTF 模型 + 抓取左右耳罩子物体
    //    这些引用需在 useEffect 作用域内声明，供 tick / ScrollTrigger 共享。
    // ---------------------------------------------------------------------
    let model: THREE.Object3D | null = null
    let leftComponent: THREE.Object3D | null = null
    let rightComponent: THREE.Object3D | null = null

    // 记录每个 Mesh 与它「原始的精美材质」，用于第三屏切换全息材质、往回滚时还原、
    // 以及卸载时正确 dispose。key=Mesh，value=原始材质（可能是数组）。
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    // 当前是否已切换为全息材质，避免每帧重复赋值。
    let isHologram = false

    // 保存记录左右耳罩「初始 X 坐标」，动画基于初始位置做相对偏移，避免多次触发累加。
    let leftInitialX = 0
    let rightInitialX = 0

    const loader = new GLTFLoader()
    // 用 Vite 的 BASE_URL 拼接资源路径，兼容配置了 base（如 /interactive-3d-product-showcase/）的场景。
    // 直接写死 '/headphone.glb' 会忽略 base 前缀，导致部署 / 预览时 404。
    const modelUrl = `${import.meta.env.BASE_URL}headphone2.glb`.replace(/\/{2,}/g, '/')
    loader.load(
      modelUrl,
      (gltf: GLTF) => {
        model = gltf.scene

        // --- 4.1 自动居中：把模型几何中心平移回原点 ---
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center) // 让模型中心对齐世界原点

        // --- 4.2 自动缩放：按包围盒最大边把模型归一化到合适尺寸 ---
        const size = box.getSize(new THREE.Vector3())
        const maxAxis = Math.max(size.x, size.y, size.z)
        const targetSize = 3.2 // 目标显示尺寸（世界单位），可按需微调
        const scale = maxAxis > 0 ? targetSize / maxAxis : 1
        model.scale.setScalar(scale)

        // --- 4.3 通过名字抓取左右耳罩子物体（Mesh）的引用 ---
        leftComponent = model.getObjectByName(LEFT_EARCUP_REPLACE) ?? null
        rightComponent = model.getObjectByName(RIGHT_EARCUP_REPLACE) ?? null

        if (leftComponent) leftInitialX = leftComponent.position.x
        if (rightComponent) rightInitialX = rightComponent.position.x

        // --- 4.4 保存每个 Mesh 的原始材质，供第三屏全息切换与还原使用 ---
        model.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh
          if (mesh.isMesh) {
            originalMaterials.set(mesh, mesh.material)
          }
        })

        if (!leftComponent || !rightComponent) {
          console.warn(
            '[ThreeCanvas] 未能通过名字找到左右耳罩，请根据上方 Scan Model Nodes 日志，' +
              '替换 LEFT_EARCUP_REPLACE / RIGHT_EARCUP_REPLACE 常量。当前拆解动画将被跳过。',
          )
        }

        scene.add(model)

        // 模型就绪后再构建滚动动画，确保 timeline 能拿到真实引用。
        buildScrollAnimation()
      },
      undefined,
      (error: unknown) => {
        console.error('[ThreeCanvas] 加载 headphone.glb 失败：', error)
      },
    )

    // ---------------------------------------------------------------------
    // 4.5 全息材质切换 / 还原：进入第三屏切为全息，往回滚还原精美原始材质。
    //     切换只做一次（isHologram 守卫），发光强弱由 u_hologramProgress 平滑控制。
    // ---------------------------------------------------------------------
    const applyHologramMaterial = (): void => {
      if (isHologram) return
      originalMaterials.forEach((_original, mesh) => {
        mesh.material = hologramMaterial
      })
      isHologram = true
    }

    const restoreOriginalMaterial = (): void => {
      if (!isHologram) return
      originalMaterials.forEach((original, mesh) => {
        mesh.material = original
      })
      isHologram = false
    }

    // ---------------------------------------------------------------------
    // 5. 构建 GSAP ScrollTrigger 动画（关联窗口整体滚动）
    // ---------------------------------------------------------------------
    const buildScrollAnimation = (): void => {
      // timeline 以窗口滚动为触发源：起点=页面顶部，终点=页面底部。
      // scrub: 1 让动画平滑地紧跟滚轮刻度（数值为追赶的秒数，越大越顺滑）。
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: document.documentElement,
          start: 'top top', // 页面顶部对齐视口顶部
          end: 'bottom bottom', // 页面底部对齐视口底部
          scrub: 1,
        },
      })

      // --- 剧情 A（第一屏 0.00~0.33）：整机自转 180° + 向相机靠近 ---
      if (model) {
        timeline.to(
          model.rotation,
          {
            y: Math.PI, // 顺时针自转 180 度
            ease: 'none',
            duration: 0.33,
          },
          0, // 从 timeline 0 时刻开始
        )
        timeline.to(
          model.position,
          {
            z: 1.2, // 沿 Z 轴向相机方向靠近一些
            ease: 'none',
            duration: 0.33,
          },
          0,
        )
      }

      // --- 剧情 B（第二屏 0.33~0.66）：Apple 风格左右耳罩拆解 ---
      if (leftComponent) {
        timeline.to(
          leftComponent.position,
          {
            x: leftInitialX - 2.0, // 基于初始位置向左推开
            ease: 'power1.inOut',
            duration: 0.33,
          },
          0.33, // 从第二屏开始
        )
      }
      if (rightComponent) {
        timeline.to(
          rightComponent.position,
          {
            x: rightInitialX + 2.0, // 基于初始位置向右推开
            ease: 'power1.inOut',
            duration: 0.33,
          },
          0.33,
        )
      }

      // --- 剧情 C（第三屏 0.66~1.00）：全息 Shader 材质切换 ---
      //   onStart：正向进入第三屏切为全息材质；
      //   onReverseComplete：反向滚出第三屏还原精美原始材质；
      //   u_hologramProgress：0→1 平滑推动，控制发光渐显强度。
      timeline.to(
        hologramMaterial.uniforms.u_hologramProgress,
        {
          value: 1,
          ease: 'power2.inOut',
          duration: 0.34,
          onStart: applyHologramMaterial,
          onReverseComplete: restoreOriginalMaterial,
        },
        0.66,
      )
    }

    // ---------------------------------------------------------------------
    // 6. resize 处理：同步相机宽高比与渲染器尺寸
    // ---------------------------------------------------------------------
    const handleResize = () => {
      sizes.width = window.innerWidth
      sizes.height = window.innerHeight

      camera.aspect = sizes.width / sizes.height
      camera.updateProjectionMatrix() // 重算投影矩阵，避免画面拉伸变形

      renderer.setSize(sizes.width, sizes.height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    }
    window.addEventListener('resize', handleResize)

    // ---------------------------------------------------------------------
    // 7. 渲染循环 tick：基于 requestAnimationFrame 的标准帧驱动
    //    模型的姿态由 GSAP 直接写入 rotation/position，这里只负责持续渲染。
    // ---------------------------------------------------------------------
    let animationFrameId = 0
    const tick = () => {
      // 每帧推进全息扫描线时间，让 GLSL 里的滚动条纹持续流动。
      hologramMaterial.uniforms.u_time.value = clock.getElapsedTime()
      renderer.render(scene, camera)
      animationFrameId = window.requestAnimationFrame(tick)
    }
    tick()

    // ---------------------------------------------------------------------
    // 8. 清理函数：彻底释放事件 / GPU / 动画资源，杜绝内存泄漏与动画错乱
    // ---------------------------------------------------------------------
    return () => {
      // 停止渲染循环
      window.cancelAnimationFrame(animationFrameId)

      // 移除事件监听
      window.removeEventListener('resize', handleResize)

      // 销毁全部 ScrollTrigger 实例，防止多页面切换时动画错乱 / 内存泄漏
      ScrollTrigger.getAll().forEach((t) => t.kill())

      // 先还原原始材质引用，确保下方释放的是「精美原始材质」而非全息材质。
      restoreOriginalMaterial()

      // 释放模型内部所有几何体与原始材质占用的显存
      if (model) {
        model.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh
          if (mesh.isMesh) {
            mesh.geometry?.dispose()
            const mat = mesh.material
            if (Array.isArray(mat)) {
              mat.forEach((m) => m.dispose())
            } else {
              mat?.dispose()
            }
          }
        })
        scene.remove(model)
      }

      // 单独释放自定义全息 ShaderMaterial（切回原始材质后它已不挂在任何 Mesh 上）。
      hologramMaterial.dispose()

      // 释放渲染器持有的 WebGL 上下文与内部缓冲
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      // 固定铺满视口，置于最底层（-z-10）并关闭指针事件（pointer-events-none），
      // 让上层 HTML 内容正常接收滚动与点击，3D 画面仅作为背景由滚动驱动。
      className="fixed inset-0 -z-10 h-full w-full pointer-events-none"
    />
  )
}