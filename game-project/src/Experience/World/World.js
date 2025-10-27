// World.js (Nivel 1 = Portal Central, Nivel 2 = Portal Central + Portal Cercano Lejano, Contadores, Portal Model)
import * as THREE from 'three';
import Environment from './Environment.js';
import Fox from './Fox.js';
import Robot from './Robot.js';
import ToyCarLoader from '../../loaders/ToyCarLoader.js';
import Floor from './Floor.js';
import ThirdPersonCamera from './ThirdPersonCamera.js';
import Sound from './Sound.js';
import AmbientSound from './AmbientSound.js';
import MobileControls from '../../controls/MobileControls.js';
import LevelManager from './LevelManager.js';
import FinalPrizeParticles from '../Utils/FinalPrizeParticles.js';
import Enemy from './Enemy.js';
import Coin from './Coin.js';
import Prize from './Prize.js';

export default class World {
	constructor(experience, { debug = false } = {}) {
		this.experience = experience;
		this.scene = this.experience?.scene;
		this.resources = this.experience?.resources;
		this.levelManager = new LevelManager(this.experience);
		this.finalPrizeActivated = false;
		this.gameStarted = false;
		this.enemies = [];
		this.coins = [];
		this.collectedCoins = 0;
		this.coinGoal = 10;
		this.debug = debug;

		// --- Lógica de Cofres ---
		this.collectedChests = 0;
		this.chestGoal = 3; // Meta de 3 cofres para el Nivel 2
		// ---

		// Flag para prevenir doble-rebote al cargar niveles
		this.isLoadingLevel = false;

		// flags para la lógica de moneda final (Nivel 1)
		this._finalCoinMade = false; // Se usará ahora para el portal central en Nivel 1
		this.finalPrizeCollected = false;

		// Sonidos
		this.coinSound = new Sound('/sounds/coin.ogg.mp3');
		this.ambientSound = new Sound('/sounds/ambiente.mp3');
		this.winner = new Sound('/sounds/winner.mp3');
		this.portalSound = new Sound('/sounds/portal.mp3');
		this.loseSound = new Sound('/sounds/lose.ogg');
		this.allowPrizePickup = false;
		setTimeout(() => { this.allowPrizePickup = true }, 2000);

		this.finalPrizeLocations = this.finalPrizeLocations || [
			{ x: 0, y: 1.5, z: 0 } // Ajusta Y si tu portal necesita otra altura
		];

		this._initWhenResourcesReady();
	}

	/**
	 * Actualiza la interfaz de usuario (UI) con los contadores.
	 */
	_updateUI() {
		if (this.experience.menu?.setStatus) {
			// Empezar con las monedas (siempre visibles)
			let status = `🪙 Monedas: ${this.collectedCoins}`;

			// Añadir cofres SOLO si estamos en el nivel 2 (usar '==' por si acaso)
			if (this.levelManager.currentLevel == 2) {
				status += ` | 📦 Cofres: ${this.collectedChests} / ${this.chestGoal}`;
			}

			if (this.debug) console.log(`[_updateUI] Nivel actual: ${this.levelManager.currentLevel}, Cofres: ${this.collectedChests}, Monedas: ${this.collectedCoins}`);
			this.experience.menu.setStatus(status);
		}
	}

	_initWhenResourcesReady() {
		try {
			this.resources = this.experience?.resources;
			if (this.resources && typeof this.resources.on === 'function') {
				this.resources.on('ready', () => this._onResourcesReady());
				if (this.resources.items && Object.keys(this.resources.items).length > 0) {
					setTimeout(() => this._onResourcesReady(), 0);
				}
			} else {
				// Fallback si resources.on no está listo de inmediato
				const start = performance.now();
				const poll = () => {
					this.resources = this.experience?.resources;
					if (this.resources && typeof this.resources.on === 'function') {
						this.resources.on('ready', () => this._onResourcesReady());
						if (this.resources.items && Object.keys(this.resources.items).length > 0) {
							setTimeout(() => this._onResourcesReady(), 0);
						}
						return;
					}
					if (this.resources && this.resources.items && Object.keys(this.resources.items).length > 0) {
						setTimeout(() => this._onResourcesReady(), 0);
						return;
					}
					if (performance.now() - start > 5000) {
						console.warn('World: resources.on no encontrado, forzando inicialización en fallback');
						setTimeout(() => this._onResourcesReady(), 0);
						return;
					}
					setTimeout(poll, 150);
				};
				poll();
			}
		} catch (err) {
			console.error('World._initWhenResourcesReady error:', err);
			setTimeout(() => this._onResourcesReady(), 0); // Intenta inicializar de todas formas
		}
	}

	async _onResourcesReady() {
		try {
			if (this.debug) console.log('World: resources ready -> initializing world content');

			this.floor = new Floor(this.experience);
			this.environment = new Environment(this.experience);

			// 1. CREAR EL ROBOT PRIMERO
			this.robot = new Robot(this.experience);

			// 2. PASAR LA REFERENCIA DEL ROBOT AL LOADER
			this.loader = new ToyCarLoader(this.experience, {
				onChestCollect: (chest) => this.handleChestCollect(chest),
				robotRef: this.robot
			});

			try {
				await this.loadLevel(1);
			} catch (err) {
				if (this.debug) console.warn('World: Fallo al cargar nivel 1, intentando loadFromAPI() como fallback', err);
				try { await this.loader.loadFromAPI() } catch (errApi) { if (this.debug) console.warn('World: ToyCarLoader.loadFromAPI fallo:', errApi) }
			}

			this.fox = new Fox(this.experience);

			this.experience.vr?.bindCharacter?.(this.robot);
			this.thirdPersonCamera = new ThirdPersonCamera(this.experience, this.robot.group);
			this.mobileControls = new MobileControls({
				onUp: (pressed) => { this.experience.keyboard.keys.up = pressed },
				onDown: (pressed) => { this.experience.keyboard.keys.down = pressed },
				onLeft: (pressed) => { this.experience.keyboard.keys.left = pressed },
				onRight: (pressed) => { this.experience.keyboard.keys.right = pressed }
			});

			if (!this.experience.physics || !this.experience.physics.world) {
				console.error('🚫 Sistema de físicas no está inicializado al cargar el mundo.');
			}

			this._checkVRMode();
			this.experience.renderer.instance.xr.addEventListener('sessionstart', () => this._checkVRMode());
		} catch (err) {
			console.error('World._onResourcesReady error:', err);
		}
	}

	spawnEnemies(count = 3) {
		if (!this.robot?.body) { if (this.debug) console.warn('spawnEnemies: robot no listo'); return }
		const zombieResource = this.resources?.items?.zombieModel;
		if (!zombieResource) { console.error('spawnEnemies: zombieModel no encontrado'); return }

		this.enemies?.forEach(e => e?.destroy?.());
		this.enemies = [];

		const playerPos = this.robot.body.position;
		const minRadius = 25;
		const maxRadius = 40;
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const radius = minRadius + Math.random() * (maxRadius - minRadius);
			const x = playerPos.x + Math.cos(angle) * radius;
			const z = playerPos.z + Math.sin(angle) * radius;
			const y = playerPos.y ?? 1.5;
			const spawnPos = new THREE.Vector3(x, y, z);

			const enemy = new Enemy({
				scene: this.scene,
				physicsWorld: this.experience.physics?.world,
				playerRef: this.robot,
				model: zombieResource,
				position: spawnPos,
				experience: this.experience,
				debug: this.debug
			});
			enemy.delayActivation = 1.0 + i * 0.5;
			enemy.isGhost = false;
			this.enemies.push(enemy);
		}
		if (this.debug) console.log(`spawnEnemies: se crearon ${this.enemies.length} enemigos`);
	}

	spawnIntelligentEnemies(count, speedMultiplier = 3.6) {
    if (!this.robot?.body) { if (this.debug) console.warn(`spawnIntelligentEnemies: robot no listo`); return }
    const zombieResource = this.resources?.items?.zombieModel;
    if (!zombieResource) { console.error('spawnIntelligentEnemies: zombieModel no encontrado'); return }

    this.enemies?.forEach(e => e?.destroy?.()); // Limpia enemigos anteriores
    this.enemies = [];

    const playerPos = this.robot.body.position;
    const minRadius = 5; // Un poco más lejos para empezar
    const maxRadius = 10;
    const defaultSpeed = 5.0; // Define una velocidad base si Enemy.js no la tiene

    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2; // Distribuirlos un poco
        const radius = minRadius + Math.random() * (maxRadius - minRadius);
        const x = playerPos.x + Math.cos(angle) * radius;
        const z = playerPos.z + Math.sin(angle) * radius;
        const y = playerPos.y ?? 1.5;
        const spawnPos = new THREE.Vector3(x, y, z);

        const enemy = new Enemy({
            scene: this.scene,
            physicsWorld: this.experience.physics?.world,
            playerRef: this.robot,
            model: zombieResource,
            position: spawnPos,
            experience: this.experience,
            debug: this.debug
        });

        // Marcar como enemigo "inteligente" (opcional) y ajustar velocidad
        enemy.isIntelligent = true; // Puedes usar esto en Enemy.js si quieres
        enemy.isGhost = false; // No son fantasmas
        enemy.speed = (enemy.baseSpeed || defaultSpeed) * speedMultiplier; // Asigna velocidad aumentada
        enemy.delayActivation = 0.5 + i * 0.2; // Activación rápida

        this.enemies.push(enemy);
    }
    if (this.debug) console.log(`spawnIntelligentEnemies: Creados ${this.enemies.length} enemigos rápidos (velocidad x${speedMultiplier})`);
  }
	

	spawnGhost() {
		if (!this.robot?.body) return;
		const zombieResource = this.resources?.items?.zombieModel;
		if (!zombieResource) return;


		const playerPos = this.robot.body.position;
		const minRadius = 25;
		const maxRadius = 40;
		const angle = Math.random() * Math.PI * 2;
		const radius = minRadius + Math.random() * (maxRadius - minRadius);
		const x = playerPos.x + Math.cos(angle) * radius;
		const z = playerPos.z + Math.sin(angle) * radius;
		const y = playerPos.y ?? 1.5;
		const spawnPos = new THREE.Vector3(x, y, z);

		const enemy = new Enemy({
			scene: this.scene,
			physicsWorld: this.experience.physics?.world,
			playerRef: this.robot,
			model: zombieResource,
			position: spawnPos,
			experience: this.experience,
			debug: this.debug
		});
		enemy.delayActivation = 0.5;
		enemy.isGhost = true;
		this.enemies.push(enemy);
		if (this.debug) console.log(`👻 spawnGhost: apareció un fantasma. Total enemigos: ${this.enemies.length}`);
	}


	async activateFinalPrize() {
		if (this.finalPrizeActivated) return;
		this.finalPrizeActivated = true;
		this._finalCoinMade = true; // Sigue siendo útil para Nivel 1
		if (this.debug) console.log('activateFinalPrize: Creando el PORTAL FINAL en el centro.');

		// --- USAR MODELO DE PORTAL ---
		let prizeModelResource;
		const portalModelResource = this.resources?.items?.portalModel;

		if (!portalModelResource) {
			if (this.debug) console.warn('activateFinalPrize: NO SE ENCONTRÓ portalModel. Usando fallback...');
			prizeModelResource = (this.loader && this.loader.prizes && this.loader.prizes[0] && this.loader.prizes[0].model) || this.resources?.items?.coinModel;
			if (!prizeModelResource) {
				 if (this.debug) console.warn('activateFinalPrize: no hay ningún modelo de premio disponible');
				 return;
			}
		} else {
			 prizeModelResource = portalModelResource;
			 if(this.debug) console.log('activateFinalPrize: Usando portalModel dedicado.');
		}
		// --- FIN: USAR MODELO DE PORTAL ---

		this.finalPrizes = this.finalPrizes || [];

		if (!this.finalPrizeLocations || !this.finalPrizeLocations.length) {
			this.finalPrizeLocations = [{ x: 0, y: 1.5, z: 0 }]; // Ajusta Y si es necesario
		}

		this.finalPrizeLocations.forEach(loc => {
			const pos = new THREE.Vector3(loc.x, loc.y, loc.z);
			const prize = new Prize({
				model: prizeModelResource,
				position: pos,
				scene: this.scene,
				role: 'finalPrize',
				sound: this.winner,
				robotRef: this.robot
			});

			if (prize.pivot) prize.pivot.visible = true;
			this.finalPrizes.push(prize);

			try {
				new FinalPrizeParticles({ scene: this.scene, targetPosition: pos, sourcePosition: pos, experience: this.experience });
			} catch (e) {
				if (this.debug) console.warn('No se pudo crear FinalPrizeParticles', e);
			}

			// Lógica para pasar de nivel al recoger el portal
			prize.onCollect = async (collectedPrize) => {
				if (this.isLoadingLevel) return;
				try {
					if (collectedPrize.role === "finalPrize") {
						this.isLoadingLevel = true;
						await this._goToNextLevel();
						this.isLoadingLevel = false;
					}
				} catch (e) {
					if (this.debug) console.warn('Error en prize.onCollect wrapper (Portal Central)', e);
				}
			};
		});

		if (window.userInteracted && this.portalSound) this.portalSound.play();
	}

	spawnFinalPrizeNearPlayer() {
		if (this.debug) console.log('spawnFinalPrizeNearPlayer: Creando portal final cerca del jugador (distancia ajustada)');

		// --- USAR MODELO DE PORTAL ---
		let prizeModelResource;
		const portalModelResource = this.resources?.items?.portalModel;
		if (!portalModelResource) {
			if (this.debug) console.warn('spawnFinalPrizeNearPlayer: NO SE ENCONTRÓ portalModel. Usando fallback...');
			prizeModelResource = (this.loader && this.loader.prizes && this.loader.prizes[0] && this.loader.prizes[0].model) || this.resources?.items?.coinModel;
		} else {
			prizeModelResource = portalModelResource;
			if (this.debug) console.log('spawnFinalPrizeNearPlayer: Usando portalModel dedicado.');
		}
		if (!prizeModelResource) { if (this.debug) console.warn('spawnFinalPrizeNearPlayer: No hay modelo disponible.'); return; }
		// --- FIN: USAR MODELO DE PORTAL ---

		// 2. Obtener la posición
		let spawnPos;
		try {
			const robotGroup = this.robot?.group;
			const playerPos = this.robot.body.position.clone();
			let forward = new THREE.Vector3(0, 0, -1);

			if (robotGroup) {
				forward.applyQuaternion(robotGroup.quaternion);
				forward.y = 0;
				forward.normalize();
			}

			const finalDistance = 12; // <-- Distancia Ajustada
			spawnPos = playerPos.add(forward.multiplyScalar(finalDistance));
			spawnPos.y = (this.robot.body.position.y ?? 1.5) + 0.6; // Ajusta Y si es necesario

			if (this.debug) console.log('spawnFinalPrizeNearPlayer: Creando portal en', spawnPos);
		} catch (e) {
			if (this.debug) console.warn('Error posicionando portal final cercano, usando fallback', e);
			spawnPos = new THREE.Vector3(this.robot.body.position.x + 8, (this.robot.body.position.y ?? 1.5) + 0.6, this.robot.body.position.z); // Fallback
		}

		// 3. Crear el objeto Prize
		const prize = new Prize({
			model: prizeModelResource,
			position: spawnPos,
			scene: this.scene,
			role: 'finalPrize',
			sound: this.winner,
			robotRef: this.robot
		});

		if (prize.pivot) prize.pivot.visible = true;
		this.finalPrizes = this.finalPrizes || [];
		this.finalPrizes.push(prize);

		try {
			new FinalPrizeParticles({
				scene: this.scene,
				targetPosition: spawnPos,
				sourcePosition: spawnPos,
				experience: this.experience
			});
		} catch (e) {
			if (this.debug) console.warn('No se pudo crear FinalPrizeParticles para portal cercano', e);
		}

		if (window.userInteracted && this.portalSound) {
			this.portalSound.play();
		}

		// Lógica para pasar de nivel al recoger el portal
		prize.onCollect = async (collectedPrize) => {
			if (this.isLoadingLevel) return;
			try {
				if (collectedPrize.role === "finalPrize") {
					this.isLoadingLevel = true;
					await this._goToNextLevel();
					this.isLoadingLevel = false;
				}
			} catch (e) {
				if (this.debug) console.warn('Error en prize.onCollect wrapper (Portal Cercano)', e);
			}
		};
	}

	spawnCoin(count = 3) {
		const coinResource = this.resources?.items?.coinModel;
		if (!coinResource || !this.robot?.body) {
			if (this.debug) console.warn('spawnCoin: coinModel o robot no disponible');
			return;
		}

		const playerPos = this.robot.body.position;
		const minRadius = 30;
		const maxRadius = 45;

		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const radius = minRadius + Math.random() * (maxRadius - minRadius);
			const angleOffset = (i - (count - 1) / 2) * 0.2;
			const x = playerPos.x + Math.cos(angle + angleOffset) * radius;
			const z = playerPos.z + Math.sin(angle + angleOffset) * radius;
			const y = (playerPos.y ?? 1.5) + 0.6;
			let spawnPos = new THREE.Vector3(x, y, z);
			let roleForThisCoin = 'default'; // <-- Siempre default, no habrá moneda final

			// El bloque IF que creaba la moneda final cercana ha sido eliminado.

			const coin = new Coin({
				scene: this.scene,
				model: coinResource,
				position: spawnPos,
				robotRef: this.robot,
				debug: this.debug,
				role: roleForThisCoin,

				onCollect: async (c) => {
					if (this.isLoadingLevel) return;

					if (window.userInteracted && this.coinSound) this.coinSound.play();
					try {
						this.collectedCoins = (this.collectedCoins || 0) + 1;
						this._updateUI(); // Actualiza contador

						if (this.debug) console.log('Monedas recogidas:', this.collectedCoins, 'role:', c.role);
						
						// Ya no hay monedas 'finalPrize', se elimina la lógica if (role === 'finalPrize')

						if (this.levelManager && typeof this.levelManager.onCoinCollected === 'function') {
							this.levelManager.onCoinCollected(c);
						}

						// Lógica Fallback Nivel 1: Llama a activateFinalPrize para crear el PORTAL
						if (!this._finalCoinMade && this.collectedCoins >= this.coinGoal) {
							if (this.debug) console.log('Fallback Nivel 1: Meta de monedas alcanzada -> activateFinalPrize() para crear PORTAL central');
							this.activateFinalPrize(); // <-- Crea el portal central
						}
					} catch (e) { if (this.debug) console.warn('onCollect error', e) }
				}
			});

			this.coins.push(coin);
			if (this.debug) console.log(`spawnCoin: moneda creada en ${spawnPos.x.toFixed(1)}, ${spawnPos.z.toFixed(1)}. Total monedas: ${this.coins.length} role=${roleForThisCoin}`);
		}
	}


	async _goToNextLevel() {
		try {
			if (this.levelManager && this.levelManager.currentLevel < this.levelManager.totalLevels) {
				if (this.debug) console.log(`_goToNextLevel: Pasando del nivel ${this.levelManager.currentLevel}...`);
				try {
					await this.levelManager.nextLevel();
				} catch (e) {
					if (this.debug) console.warn('levelManager.nextLevel fallo', e);
				}
			} else {
				if (this.debug) console.log('_goToNextLevel: Último nivel completado. Fin del juego.');
				// Lógica de "Ganaste" (Fin del juego)
				if (this.experience && this.experience.tracker) {
					const elapsed = this.experience.tracker.stop();
					this.experience.tracker.saveTime(elapsed);
					this.experience.tracker.showEndGameModal(elapsed);
				} else if (this.debug) {
					console.warn('_goToNextLevel: tracker no disponible');
				}
			}
		} catch (e) {
			if (this.debug) console.warn('Error ejecutando lógica _goToNextLevel', e);
		}
	}


	async handleChestCollect(prize) {
      // --- CORRECCIÓN: Eliminado '|| prize.collected' ---
      if (this.isLoadingLevel || !prize /* || prize.collected */) {
          if (this.debug) console.log('[handleChestCollect] Ignorado por isLoadingLevel o !prize');
          return;
      }

      if (window.userInteracted && this.coinSound) {
          this.coinSound.play();
      }

      console.log(`[handleChestCollect] ANTES de incrementar: collectedChests = ${this.collectedChests}`);
      this.collectedChests++;
      console.log(`[handleChestCollect] DESPUÉS de incrementar: collectedChests = ${this.collectedChests}`);

      this._updateUI(); // Actualiza contador

      if (this.debug) console.log(`📦 Cofre recogido! Total real: ${this.collectedChests}/${this.chestGoal}`);

      // --- Lógica de Final de Nivel por Cofres (Nivel 2 y 3) ---
      const currentLevel = this.levelManager.currentLevel; // Guardar nivel actual

      // Verificar si se alcanzó la meta para el nivel actual (2 o 3)
      let goalReached = false;
      if (currentLevel == 2 && this.collectedChests >= this.chestGoal) {
          goalReached = true;
          if (this.debug) console.log('Meta de cofres Nivel 2 alcanzada!');
      } else if (currentLevel == 3 && this.collectedChests >= this.chestGoal) {
          goalReached = true;
          if (this.debug) console.log('Meta de cofres Nivel 3 alcanzada!');
      }

      // Si se alcanzó la meta Y el premio final aún no está activo
      if (goalReached && !this.finalPrizeActivated) {

          if (currentLevel == 2) {
              // Nivel 2: Activa AMBOS portales
              if (this.debug) console.log('Activando AMBOS portales para Nivel 2.');
              this.activateFinalPrize();       // Portal Central
              this.spawnFinalPrizeNearPlayer(); // Portal Cercano (distancia 12)
          } else if (currentLevel == 3) {
              // Nivel 3: Activa SÓLO el portal central
              if (this.debug) console.log('Activando SÓLO el portal central para Nivel 3.');
              this.activateFinalPrize();       // Portal Central
          }
      }
  }




	increaseGhostSpeed(multiplier = 1.2) {
		this.enemies?.forEach(enemy => {
			if (enemy.isGhost) {
				enemy.speed = (enemy.speed || 1) * multiplier;
				if (this.debug) console.log(`increaseGhostSpeed: nueva velocidad ${enemy.speed.toFixed(2)}`);
			}
		});
	}

	toggleAudio() { this.ambientSound.toggle() }

	update(delta) {
		const deltaSeconds = (typeof delta === 'number' && delta > 0 && delta < 0.1) ? delta : 0.016; // Usa fallback si delta es inválido
		this.fox?.update?.(deltaSeconds);
		this.robot?.update?.();

		if (this.gameStarted) {
			this.enemies?.forEach(e => { try { e.update(deltaSeconds) } catch (err) { /* Ignora errores de update */ } });

			// Lógica de Derrota
			if (!this.defeatTriggered) {
				const distToClosest = this.enemies?.reduce((min, e) => {
					if (!e?.body?.position || !this.robot?.body?.position) return min;
					const d = e.body.position.distanceTo(this.robot.body.position);
					return Math.min(min, d);
				}, Infinity) ?? Infinity;

				if (distToClosest < 1.0) {
					this.defeatTriggered = true;
					if (window.userInteracted && this.loseSound) this.loseSound.play();
					const firstEnemy = this.enemies?.[0];
					const enemyMesh = firstEnemy?.model || firstEnemy?.group;
					if (enemyMesh) { enemyMesh.scale.set(1.3, 1.3, 1.3); setTimeout(() => enemyMesh.scale.set(1, 1, 1), 500) }
					this.experience.modal.show({
						icon: '💀',
						message: '¡El enemigo te atrapó!\n¿Quieres intentarlo otra vez?',
						buttons: [
							{ text: '🔁 Reintentar', onClick: () => this.experience.resetGameToFirstLevel() },
							{ text: '❌ Salir', onClick: () => this.experience.resetGame() }
						]
					});
					return; // Detiene update si pierdes
				}
			}
		}

		if (this.thirdPersonCamera && this.experience.isThirdPerson && !this.experience.renderer.instance.xr.isPresenting) {
			this.thirdPersonCamera.update();
		}

		// Actualizar y limpiar monedas recolectadas
		if (this.coins && this.coins.length) {
			for (let i = this.coins.length - 1; i >= 0; i--) {
				const c = this.coins[i];
				try {
					c.update(deltaSeconds);
					if (c.collected) {
						try { c.destroy() } catch (e) {}
						this.coins.splice(i, 1);
					}
				} catch (e) { if (this.debug) console.warn('Error actualizando coin', e) }
			}
		}

		// Actualizar premios finales (portales)
		if (this.finalPrizes && this.finalPrizes.length) {
			this.finalPrizes.forEach(p => {
				try { p.update?.(deltaSeconds) } catch (e) { /* Ignora error */ }
			});
		}

		// Actualizar cofres (Prizes del loader)
		this.loader?.prizes?.forEach(p => { try { p.update?.(deltaSeconds) } catch (e) { /* Ignora error */ } });

		// Optimización de físicas
		const playerPos = this.experience.renderer.instance.xr.isPresenting
			? this.experience.camera.instance.position
			: this.robot?.body?.position;

		if (playerPos) {
			this.scene.traverse((obj) => {
				if (obj.userData?.levelObject && obj.userData.physicsBody) {
					const dist = obj.position.distanceTo(playerPos);
					const shouldEnable = dist < 40 && obj.visible; // Solo activa si está cerca Y visible

					const body = obj.userData.physicsBody;
					if (shouldEnable && !body.enabled) {
						body.enabled = true;
					} else if (!shouldEnable && body.enabled) {
						body.enabled = false;
					}
				}
			});
		}
	}


	clearCurrentScene() {
		if (this.ghostSpawnInterval) { clearInterval(this.ghostSpawnInterval); this.ghostSpawnInterval = null }
		if (this.ghostSpeedInterval) { clearInterval(this.ghostSpeedInterval); this.ghostSpeedInterval = null }
		if (this.coinSpawnInterval) { clearInterval(this.coinSpawnInterval); this.coinSpawnInterval = null }

		this.enemies?.forEach(e => e?.destroy?.());
		this.enemies = [];

		this.coins?.forEach(c => { try { c.destroy() } catch (e) {} });
		this.coins = [];

		// Limpiar portales finales
		if (this.finalPrizes && this.finalPrizes.length) {
			this.finalPrizes.forEach(p => { try { p.destroy?.() } catch (e) {} });
			this.finalPrizes = [];
		}
		// Limpiar cofres/premios del loader
		if (this.loader && this.loader.prizes && this.loader.prizes.length > 0) {
			this.loader.prizes.forEach(prize => {
				try { prize.destroy() } catch(e) {}
			});
			this.loader.prizes = [];
			if (this.debug) console.log('🎯 Premios/Cofres (loader.prizes) del nivel anterior eliminados.');
		}


		this._finalCoinMade = false;
		this.finalPrizeCollected = false;
		this.collectedChests = 0; // Resetea cofres
		this.finalPrizeActivated = false; // Resetea activación de premio


		if (!this.experience || !this.scene || !this.experience.physics || !this.experience.physics.world) {
			console.warn('⚠️ No se puede limpiar (clearCurrentScene): sistema de físicas no disponible.');
			return;
		}

		// Limpieza de objetos 3D y físicos marcados como 'levelObject'
		let visualObjectsRemoved = 0;
		let physicsBodiesRemoved = 0;
		const childrenToRemove = [];
		const bodiesToRemoveFromPhysics = [];

		this.scene.children.forEach((child) => {
			if (child.userData && child.userData.levelObject) {
				childrenToRemove.push(child);
				if (child.userData.physicsBody) {
					bodiesToRemoveFromPhysics.push(child.userData.physicsBody);
				}
			}
		});

		childrenToRemove.forEach((child) => {
			// Limpieza de memoria Three.js
			if (child.geometry) child.geometry.dispose();
			if (child.material) {
				if (Array.isArray(child.material)) {
					child.material.forEach(mat => mat.dispose());
				} else {
					child.material.dispose();
				}
			}
			this.scene.remove(child);
			visualObjectsRemoved++;
		});

		// Limpieza de cuerpos físicos de Cannon.js
		bodiesToRemoveFromPhysics.forEach(body => {
			this.experience.physics.world.removeBody(body);
			physicsBodiesRemoved++;
		});

		// Actualizar el array interno de cuerpos físicos si existe
		if (this.experience.physics && Array.isArray(this.experience.physics.bodies)) {
			this.experience.physics.bodies = this.experience.physics.bodies.filter(
				body => !bodiesToRemoveFromPhysics.includes(body)
			);
		}


		if (this.debug) {
			console.log(`🧹 Escena limpiada (level transition).`);
			console.log(`✅ Objetos 3D (levelObject) eliminados: ${visualObjectsRemoved}`);
			console.log(`✅ Cuerpos físicos (levelObject) eliminados: ${physicsBodiesRemoved}`);
			const currentBodies = this.experience.physics?.world?.bodies?.length ?? 'N/A';
			console.log(`🎯 Cuerpos físicos restantes en Physics World: ${currentBodies}`);
		}
	}


	async loadLevel(level) {
    try {
        if(this.debug) console.log(`--- Iniciando carga de Nivel ${level} ---`);

        // 1. LIMPIAR ESCENA ANTERIOR
        this.clearCurrentScene(); // Limpia objetos, física e intervalos

        // 2. CARGAR DATOS DEL NIVEL
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
        const apiUrl = `${backendUrl}/api/blocks?level=${level}`;
        let data;

        try {
            // Intenta cargar desde API
            const res = await fetch(apiUrl);
            if (!res.ok) throw new Error(`Error API (${res.status})`);
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) {
                const preview = (await res.text()).slice(0, 120);
                throw new Error(`Respuesta no-JSON desde API (${apiUrl}): ${preview}`);
            }
            data = await res.json();
            if (!data.blocks || data.blocks.length === 0) {
                console.warn(`⚠️ API no devolvió bloques para el nivel ${level}. Forzando fallback a local.`);
                throw new Error('API data vacía, usando fallback');
            }
            if (this.debug) console.log(`📦 Datos del nivel ${level} cargados desde API (${data.blocks.length} bloques).`);
        } catch (error) {
            // Fallback a archivo local si falla la API
            if (this.debug) console.warn(`⚠️ Usando datos locales para nivel ${level}... (${error.message})`);
            const publicPath = (p) => {
                const base = import.meta.env.BASE_URL || '/';
                return `${base.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
            };
            const localUrl = publicPath('data/toy_car_blocks.json');
            const localRes = await fetch(localUrl);
            if (!localRes.ok) throw new Error(`No se pudo cargar ${localUrl} (HTTP ${localRes.status})`);
            const allBlocks = await localRes.json();
            const filteredBlocks = allBlocks.filter(b => b.level == level); // Usa == por si level es string/number
            console.log(`📦 [LOAD_LEVEL] Cargando Nivel ${level} (local). ${filteredBlocks.length} bloques encontrados.`);
            data = {
                blocks: filteredBlocks,
                spawnPoint: filteredBlocks.find(b => b.role === 'spawnPoint') // Busca spawn point en los datos filtrados
            };
            // Define spawn points por defecto si no se encuentran en el JSON local
            if (!data.spawnPoint) {
                if (level == 1) data.spawnPoint = { x: -17, y: 1.5, z: -67 };
                else if (level == 2) data.spawnPoint = { x: 5, y: 1.5, z: 5 };
                else if (level == 3) data.spawnPoint = { x: 10, y: 1.5, z: 10 }; // Spawn Nivel 3
                else data.spawnPoint = { x: 0, y: 1.5, z: 0 }; // Fallback general
                 if (this.debug) console.log(`loadLevel: Usando spawnPoint por defecto para Nivel ${level}`);
            }
        }

        const spawnPoint = data.spawnPoint || { x: 0, y: 1.5, z: 0 }; // Asegura que siempre haya un spawnPoint

        // 3. RESETEAR ESTADO DEL JUEGO
        this.points = 0; // Si usaras puntos
        this.collectedCoins = 0;
        if (this.robot) this.robot.points = 0; // Si el robot tuviera puntos
        this.finalPrizeActivated = false;
        this._finalCoinMade = false;
        this.defeatTriggered = false;
        this.finalPrizeCollected = false;
        this.collectedChests = 0;

        // Establecer meta de cofres según el nivel
        if (level == 3) {
            this.chestGoal = 10;
        } else if (level == 2) {
            this.chestGoal = 3;
        } else {
            this.chestGoal = 0; // Nivel 1 no usa cofres
        }
        if(this.debug) console.log(`loadLevel: Meta de cofres para Nivel ${level} establecida en ${this.chestGoal}`);

        this._updateUI(); // Actualiza UI con contadores reseteados y meta correcta

        // 4. PROCESAR Y CARGAR BLOQUES (Geometría, Física, Cofres)
        if (data.blocks && data.blocks.length > 0) {
            const publicPath = (p) => {
              const base = import.meta.env.BASE_URL || '/';
              return `${base.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
            };
            const preciseUrl = publicPath('config/precisePhysicsModels.json');
            let preciseModels = [];
            try {
              const preciseRes = await fetch(preciseUrl);
              if (preciseRes.ok) preciseModels = await preciseRes.json();
              else console.warn(`No se pudo cargar ${preciseUrl}`);
            } catch(e) { console.error('Error cargando precisePhysicsModels.json', e); }

            this.loader._processBlocks(data.blocks, preciseModels); // Crea objetos 3D, física estática y cofres
        } else {
            if (this.debug) console.warn(`No se encontraron bloques (blocks) para el nivel ${level} en los datos cargados.`);
        }

        // 5. COLOCAR AL JUGADOR
        this.resetRobotPosition(spawnPoint);
        if (this.debug) console.log(`✅ Robot posicionado en spawn point: X=${spawnPoint.x.toFixed(2)}, Y=${spawnPoint.y.toFixed(2)}, Z=${spawnPoint.z.toFixed(2)}`);

        // --- AÑADIR RETRASO ---
        // Espera un breve momento (100ms) para que el motor de física procese la nueva posición del robot
        await new Promise(resolve => setTimeout(resolve, 100));
        if (this.debug) console.log(`-- Retraso post-reset completado. Procediendo a spawnear enemigos --`);
        // --- FIN RETRASO ---

        // 6. REINICIAR/CONFIGURAR GENERADORES DINÁMICOS
        // (Intervalos ya limpiados en clearCurrentScene)
        if (level == 1) {
            if (this.debug) console.log("loadLevel: Configurando spawners para Nivel 1 (Monedas y Fantasmas)");
            this.coinSpawnInterval = setInterval(() => {
                if (this.levelManager.currentLevel == 1) { this.spawnCoin(3); }
                else { clearInterval(this.coinSpawnInterval); this.coinSpawnInterval = null; } // Seguridad
            }, 10000);
            this.ghostSpawnInterval = setInterval(() => { if (this.levelManager.currentLevel == 1) this.spawnGhost(); }, 30000);
            this.ghostSpeedInterval = setInterval(() => { if (this.levelManager.currentLevel == 1) this.increaseGhostSpeed(1.3); }, 20000);
            this.spawnEnemies(1); // Enemigo inicial normal
        } else if (level == 2) {
            if (this.debug) console.log("loadLevel: Configurando spawners para Nivel 2 (3 Enemigos Rápidos)");
            this.spawnIntelligentEnemies(3, 2.5); // 3 enemigos, velocidad x2.5
        } else if (level == 3) {
            if (this.debug) console.log("loadLevel: Configurando spawners para Nivel 3 (5 Enemigos Muy Rápidos)");
            this.spawnIntelligentEnemies(5, 3.5); // 5 enemigos, velocidad x3.5
        } else {
             if (this.debug) console.log(`loadLevel: No hay configuración de spawners para Nivel ${level}`);
        }

        this.gameStarted = true; // Activa la lógica de update (derrota, etc.)
        if (this.debug) console.log(`--- Nivel ${level} cargado exitosamente ---`);

    } catch (error) {
        console.error(`❌ Error MUY GRAVE cargando nivel ${level}:`, error);
        // Aquí podrías mostrar un mensaje de error en la UI si lo deseas
    }
  }

	resetRobotPosition(spawn = { x: 0, y: 1.5, z: 0 }) { // Spawn por defecto más seguro
		if (!this.robot?.body || !this.robot?.group) {
			if(this.debug) console.warn('resetRobotPosition: No se pudo resetear, robot no listo.');
			return;
		}
		// Resetear físicas
		this.robot.body.position.set(spawn.x, spawn.y, spawn.z);
		this.robot.body.velocity.set(0, 0, 0);
		this.robot.body.angularVelocity.set(0, 0, 0);
		this.robot.body.quaternion.setFromEuler(0, 0, 0); // Orientación inicial
		// Sincronizar visual
		this.robot.group.position.copy(this.robot.body.position);
		this.robot.group.quaternion.copy(this.robot.body.quaternion);
	}

	_checkVRMode() {
		const isVR = this.experience.renderer.instance.xr.isPresenting;
		if (isVR) {
			if (this.robot?.group) this.robot.group.visible = false;
			this.enemies?.forEach(e => { if (e) e.delayActivation = Math.max(e.delayActivation || 0, 3.0) });
			this.experience.camera.instance.position.set(5, 1.6, 5); // Posición inicial VR
			this.experience.camera.instance.lookAt(new THREE.Vector3(5, 1.6, 4));
		} else {
			if (this.robot?.group) this.robot.group.visible = true;
		}
	}
}