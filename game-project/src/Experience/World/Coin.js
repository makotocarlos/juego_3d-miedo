// Coin.js
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

export default class Coin {
  /**
   * options = {
   *   scene,
   *   model,           // resource GLTF (this.resources.items.coinModel)
   *   position: THREE.Vector3,
   *   robotRef,        // referencia al robot para comprobación de recogida
   *   onCollect: fn,   // callback cuando se recoge
   *   debug = false
   * }
   */
  constructor(options = {}) {
    this.scene = options.scene
    this.model = options.model
    this.position = options.position || new THREE.Vector3()
    this.robotRef = options.robotRef
    this.onCollect = options.onCollect || (() => {})
    this.debug = options.debug || false

    this.group = new THREE.Group()
    this.group.position.copy(this.position)
    this.scene.add(this.group)

    this.rotationSpeed = 1.6 // rad/s
    this.bobAmplitude = 0.25
    this.bobSpeed = 2.2
    this._time = 0
    this.collected = false

    this._setupModel()
  }

  _setupModel() {
    try {
      if (!this.model) {
        // fallback simple geometry si no hay modelo
        const geo = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 32)
        const mat = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.3 })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = Math.PI / 2
        this.group.add(mesh)
        return
      }

      // El resource GLTF puede venir como { scene, scenes, scene: Group, ... }
      // hacemos un clone profundo usando SkeletonUtils para no tocar el original
      let cloned
      try {
        cloned = SkeletonUtils.clone(this.model.scene || this.model)
      } catch (e) {
        // fallback
        cloned = (this.model.scene && this.model.scene.clone(true)) || this.model.clone(true)
      }

      // Normalizar tamaño y orientación si hace falta
      cloned.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })

      // Centrar modelo y escalar si es necesario
      const box = new THREE.Box3().setFromObject(cloned)
      const size = new THREE.Vector3()
      box.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const desiredSize = 0.8 // aproximado
      const scale = desiredSize / maxDim
      cloned.scale.setScalar(scale)
      cloned.position.y -= (box.min.y * scale) // intentar ajustar al suelo de la moneda

      this.group.add(cloned)
      this.mesh = cloned
    } catch (err) {
      console.error('Coin._setupModel error:', err)
    }
  }

  update(delta) {
    if (this.collected) return
    // delta en segundos
    this._time += delta
    // rotación continua
    this.group.rotation.y += this.rotationSpeed * delta
    // bob (subir/bajar)
    const y = Math.sin(this._time * this.bobSpeed) * this.bobAmplitude
    this.group.position.y = this.position.y + y

    // check recogida por distancia (si hay robotRef con body o group)
    try {
      const robotPos = (this.robotRef?.body && this.robotRef.body.position) ? this.robotRef.body.position : (this.robotRef?.group?.position)
      if (robotPos) {
        const coinPos = this.group.position
        const dx = robotPos.x - coinPos.x
        const dy = robotPos.y - coinPos.y
        const dz = robotPos.z - coinPos.z
        const distSq = dx*dx + dy*dy + dz*dz
        const pickupRadius = 2.0 // ajustar si quieres más/menos alcance
        if (distSq <= pickupRadius * pickupRadius) {
          this.collect()
        }
      }
    } catch (e) {
      if (this.debug) console.warn('Coin.update: error comprobando recogida', e)
    }
  }

  collect() {
    if (this.collected) return
    this.collected = true
    // animación simple antes de borrar (escalado rápido)
    const g = this.group
    // si tienes gsap en el proyecto, puedes reemplazar por gsap.to(...)
    const duration = 200
    const start = performance.now()
    const startScale = g.scale.clone()

    const tick = (t) => {
      const elapsed = t - start
      const p = Math.min(1, elapsed / duration)
      const s = 1 - p
      g.scale.set(startScale.x * s, startScale.y * s, startScale.z * s)
      if (p < 1) requestAnimationFrame(tick)
      else this.destroy()
    }
    requestAnimationFrame(tick)

    // callback (ej: play sound, aumentar score)
    try { this.onCollect(this) } catch (e) {}
  }

  destroy() {
    try {
      if (this.group.parent) this.group.parent.remove(this.group)
      this.group.traverse(c => {
        if (c.geometry) c.geometry.dispose()
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose && m.dispose())
          else c.material.dispose && c.material.dispose()
        }
      })
    } catch (e) {}
  }
}
