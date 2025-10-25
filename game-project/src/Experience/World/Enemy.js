// Enemy.js (Vite/ESM compatible, robusto para SkinnedMesh y velocidad variable)
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import FinalPrizeParticles from '../Utils/FinalPrizeParticles.js'
import Sound from './Sound.js'

export default class Enemy {
    constructor({ scene, physicsWorld, playerRef, model, position = new THREE.Vector3(), experience, debug = true }) {
        this.experience = experience
        this.scene = scene
        this.physicsWorld = physicsWorld
        this.playerRef = playerRef
        this.baseSpeed = 1.0
        this.speed = this.baseSpeed
        this.debug = debug
        this.isGhost = false // será true para los fantasmas

        // Sonido de proximidad
        this.proximitySound = new Sound('/sounds/alert2.mp3', { loop: true, volume: 0 })
        this.proximitySound.play()

        // Clonar el modelo para usar animaciones
        let sourceScene = model.scene || model
        let sourceClips = model.animations || (this.experience?.resources?.items?.zombieModel?.animations) || []

        this.model = SkeletonUtils.clone(sourceScene)

        this.model.traverse((c) => {
            if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false; }
            if (c.isSkinnedMesh && c.skeleton?.bones?.length) c.bind(c.skeleton, c.bindMatrix)
        })

        // Contenedor
        this.container = new THREE.Group()
        this.container.position.copy(position)
        this.scene.add(this.container)
        this.container.add(this.model)
        this.model.position.set(0, 0, 0)

        // Mixer y animaciones
        this.mixer = sourceClips.length ? new THREE.AnimationMixer(this.model) : null
        this.actions = {}
        this.currentAction = null
        if (this.mixer && sourceClips.length > 0) {
            const walkClip = sourceClips.find(c => /walk|run/i.test(c.name)) || sourceClips[0]
            if (walkClip) {
                const walkAction = this.mixer.clipAction(walkClip)
                walkAction.setLoop(THREE.LoopRepeat)
                walkAction.play()
                this.actions.walk = walkAction
            }
        }

        // Física
        const shape = new CANNON.Sphere(0.5)
        const enemyMaterial = new CANNON.Material('enemyMaterial')
        enemyMaterial.friction = 0.0
        this.body = new CANNON.Body({
            mass: 5,
            shape,
            material: enemyMaterial,
            position: new CANNON.Vec3(position.x, position.y, position.z),
            linearDamping: 0.01
        })
        this.physicsWorld?.addBody(this.body)
        this.body.sleepSpeedLimit = 0.0
        this.body.wakeUp()
        this.model.userData.physicsBody = this.body

        // Colisión con jugador
        this._onCollide = (event) => {
            if (event.body === this.playerRef?.body) {
                if (typeof this.playerRef.die === 'function') this.playerRef.die()
                this.proximitySound?.stop()
                if (this.container.parent) {
                    new FinalPrizeParticles({
                        scene: this.scene,
                        targetPosition: this.body.position,
                        sourcePosition: this.body.position,
                        experience: this.experience
                    })
                    this.destroy()
                }
            }
        }
        if (this.body?.addEventListener) this.body.addEventListener('collide', this._onCollide)

        this.turnSpeed = 6.0
        this.moveThreshold = 0.5
        if (this.debug) console.log('[Enemy] Inicializado en:', position)
    }

    _setAction(actionName, { fade = 0.18 } = {}) {
        if (!this.mixer || !this.actions[actionName]) return
        const newAction = this.actions[actionName]
        const oldAction = this.currentAction
        if (oldAction === newAction) return
        newAction.enabled = true
        newAction.reset()
        newAction.fadeIn(fade)
        newAction.play()
        if (oldAction) oldAction.fadeOut(fade)
        this.currentAction = newAction
    }

    update(delta) {
        if (!this.body || !this.playerRef?.body) return

        this.mixer?.update(delta)

        const targetPos = this.playerRef.body.position
        const enemyPos = this.body.position

        const dx = targetPos.x - enemyPos.x
        const dz = targetPos.z - enemyPos.z
        const dist2D = Math.hypot(dx, dz)

        // Para fantasmas, usar this.speed (puede actualizarse desde World.js)
        const currentSpeed = this.isGhost ? this.speed : this.baseSpeed
        const nx = dx / dist2D
        const nz = dz / dist2D

        if (dist2D > this.moveThreshold) {
            this.body.velocity.x = nx * currentSpeed
            this.body.velocity.z = nz * currentSpeed
            this.actions.walk && this._setAction('walk', { fade: 0.12 })
            const targetAngle = Math.atan2(nx, nz)
            const qTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetAngle, 0))
            this.container.quaternion.slerp(qTarget, Math.min(1, this.turnSpeed * delta))
        } else {
            this.body.velocity.x = 0
            this.body.velocity.z = 0
        }

        this.container.position.copy(this.body.position)
        this.model.position.set(0, 0, 0)

        // Ajustar volumen de proximidad
        const maxDistance = 10
        const clampedDistance = Math.min(dist2D, maxDistance)
        const proximityVolume = 1 - (clampedDistance / maxDistance)
        this.proximitySound?.setVolume(proximityVolume * 0.8)
    }

    destroy() {
        if (this.container) this.scene.remove(this.container)
        this.proximitySound?.stop()
        if (this.body) {
            try { this.body.removeEventListener('collide', this._onCollide) } catch {}
            this.physicsWorld?.removeBody?.(this.body)
            this.body = null
        }
        if (this.mixer) {
            try { this.mixer.stopAllAction() } catch {}
            this.mixer = null
        }
    }
}
