<script lang="ts">
	import { onMount } from 'svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	let { data } = $props();
	const columns = 40;
	const rows = 24;
	type Presence = {
		id: string;
		userId: string;
		username: string;
		avatarUrl: string | null;
		x: number;
		y: number;
	};
	let rooms = $state<typeof data.rooms>([]);
	let walls = $state<typeof data.walls>([]);
	let settings = $state<typeof data.settings>(null);
	let building = $state(false);
	let buildTool = $state<'room' | 'wall' | 'eraser'>('room');
	let start = $state<{ x: number; y: number } | null>(null);
	let end = $state<{ x: number; y: number } | null>(null);
	let socket = $state<WebSocket | null>(null);
	let connected = $state(false);
	let processing = $state(false);
	let roomCreationRequestId: string | null = null;
	let roomEditRequestId: string | null = null;
	let selectedRoom = $state<(typeof data.rooms)[number] | null>(null);
	let roomDeletionOpen = $state(false);
	let editSession: {
		mode: 'move' | 'resize';
		pointerId: number;
		origin: { x: number; y: number };
		initial: (typeof data.rooms)[number];
	} | null = null;
	let movingToVoiceChannel = $state(false);
	let autoMoveVoiceChannel = $state(true);
	let revealedEdge = $state<'top' | 'right' | 'bottom' | 'all' | null>(null);
	let presenceId = $state<string | null>(null);
	let presences = $state<Presence[]>([]);
	let movementFrame: number | null = null;
	let velocityX = 0;
	let velocityY = 0;
	let lastMovementFrameAt: number | null = null;
	const maximumMovementSpeed = 10.8;
	const movementAcceleration = 34;
	const movementFriction = 54;
	let cameraFrame: number | null = null;
	let zoomFrame: number | null = null;
	let cameraX = $state(0);
	let cameraY = $state(0);
	let targetZoom = $state(1);
	let renderedZoom = $state(1);
	let cameraInitialized = false;
	let lastMovementSentAt = 0;
	const pressedKeys = new Set<string>();
	const movementKeys = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']);
	const movementCodes: Record<string, string> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
	let notice = $state<{ success: boolean; message: string } | null>(null);
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let lastMessageAt = Date.now();
	let stopped = false;
	let connectionVersion = 0;
	let activeGuildId: string | null = null;
	let worldViewport = $state<HTMLDivElement>();
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);

	$effect(() => {
		const currentNotice = notice;
		if (!currentNotice) return;
		const timer = window.setTimeout(() => {
			if (notice === currentNotice) notice = null;
		}, 3_000);
		return () => window.clearTimeout(timer);
	});

	onMount(() => {
		const savedAutoMove = localStorage.getItem(`basecamp-auto-move:${data.guildId}`);
		autoMoveVoiceChannel = savedAutoMove === null || savedAutoMove === 'true';
		const resizeObserver = new ResizeObserver(([entry]) => {
			viewportWidth = entry.contentRect.width;
			viewportHeight = entry.contentRect.height;
		});
		if (worldViewport) resizeObserver.observe(worldViewport);
		const keydown = (event: KeyboardEvent) => {
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)
				return;
			const key = movementCodes[event.code] || event.key.toLowerCase();
			if (!movementKeys.has(key)) return;
			event.preventDefault();
			pressedKeys.add(key);
			if (movementFrame === null) moveAvatar();
		};
		const keyup = (event: KeyboardEvent) => {
			const key = movementCodes[event.code] || event.key.toLowerCase();
			if (!movementKeys.has(key)) return;
			pressedKeys.delete(key);
			if (![...pressedKeys].some((pressed) => movementKeys.has(pressed))) {
				if (movementFrame === null) moveAvatar();
			}
		};
		window.addEventListener('keydown', keydown);
		window.addEventListener('keyup', keyup);
		return () => {
			stopped = true;
			connectionVersion += 1;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			socket?.close(1000);
			window.removeEventListener('keydown', keydown);
			window.removeEventListener('keyup', keyup);
			if (movementFrame !== null) cancelAnimationFrame(movementFrame);
			if (cameraFrame !== null) cancelAnimationFrame(cameraFrame);
			if (zoomFrame !== null) cancelAnimationFrame(zoomFrame);
			resizeObserver.disconnect();
		};
	});

	$effect(() => {
		const guildId = data.guildId;
		if (activeGuildId === guildId) return;
		activeGuildId = guildId;
		rooms = [...data.rooms];
		walls = [...data.walls];
		settings = data.settings;
		connectionVersion += 1;
		const version = connectionVersion;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		socket?.close(1000);
		socket = null;
		connected = false;
		processing = false;
		presenceId = null;
		presences = [];
		void connect(version);
	});

	async function connect(version: number) {
		const guildId = activeGuildId;
		if (!guildId || stopped || version !== connectionVersion) return;
		try {
			const response = await fetch(`/api/guilds/${guildId}/realtime-ticket`, { method: 'POST' });
			if (!response.ok) throw new Error('Basecamp 연결 티켓을 발급받지 못했습니다.');
			const { ticket } = (await response.json()) as { ticket: string };
			if (stopped || version !== connectionVersion) return;
			const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			const next = new WebSocket(`${protocol}//${location.host}/ws/basecamp?ticket=${encodeURIComponent(ticket)}`);
			socket = next;
			next.onopen = () => {
				connected = true;
				notice = null;
				lastMessageAt = Date.now();
				if (!heartbeatTimer)
					heartbeatTimer = setInterval(() => {
						if (!socket || socket.readyState !== WebSocket.OPEN) return;
						if (Date.now() - lastMessageAt > 45_000) {
							socket.close(4000, 'Basecamp heartbeat timed out');
							return;
						}
						socket.send(JSON.stringify({ type: 'basecamp-ping' }));
					}, 15_000);
			};
			next.onmessage = (event) => {
				lastMessageAt = Date.now();
				const message = JSON.parse(String(event.data)) as Record<string, unknown>;
				if (message.type === 'basecamp-connected') {
					presenceId = String(message.presenceId || '');
					next.send(
						JSON.stringify({ type: 'basecamp-auto-move', enabled: autoMoveVoiceChannel })
					);
					return;
				}
				if (message.type === 'basecamp-voice-status') {
					notice = { success: message.ok === true, message: String(message.message || '') };
					return;
				}
				if (message.type === 'basecamp-presences') {
					const incoming = message.presences as Presence[];
					const me = presences.find((presence) => presence.id === presenceId);
					presences = incoming.map((presence) =>
						presence.id === presenceId && me ? { ...presence, x: me.x, y: me.y } : presence
					);
					return;
				}
				if (message.type === 'basecamp-state') {
					rooms = message.rooms as typeof rooms;
					walls = message.walls as typeof walls;
					settings = message.settings as typeof settings;
					return;
				}
				if (message.type === 'basecamp-result') {
					processing = false;
					const success = message.ok === true;
					const isRoomCreation = message.requestId === roomCreationRequestId;
					const isRoomEdit = message.requestId === roomEditRequestId;
					notice = {
						success,
						message: String(success ? message.message || '' : message.error || '')
					};
					if (isRoomCreation) {
						roomCreationRequestId = null;
						if (success) {
							cancelDraft();
							building = false;
						}
					}
					if (isRoomEdit) {
						roomEditRequestId = null;
						if (success) {
							selectedRoom = null;
							building = false;
						}
					}
				}
			};
			next.onclose = () => {
				if (socket === next) socket = null;
				connected = false;
				processing = false;
				roomCreationRequestId = null;
				roomEditRequestId = null;
				presenceId = null;
				presences = [];
				if (!stopped && version === connectionVersion)
					reconnectTimer = setTimeout(() => void connect(version), 1500);
			};
			next.onerror = () => next.close();
		} catch (error) {
			connected = false;
			notice = {
				success: false,
				message: error instanceof Error ? error.message : 'Basecamp에 연결하지 못했습니다.'
			};
			if (!stopped && version === connectionVersion)
				reconnectTimer = setTimeout(() => void connect(version), 1500);
		}
	}

	function moveAvatar(timestamp = performance.now()) {
		movementFrame = null;
		if (building || !presenceId) {
			velocityX = 0;
			velocityY = 0;
			lastMovementFrameAt = null;
			return;
		}
		const me = presences.find((presence) => presence.id === presenceId);
		if (!me) {
			movementFrame = requestAnimationFrame(moveAvatar);
			return;
		}
		const deltaSeconds = lastMovementFrameAt === null
			? 1 / 60
			: Math.min(0.05, Math.max(0.001, (timestamp - lastMovementFrameAt) / 1_000));
		lastMovementFrameAt = timestamp;
		const horizontal = Number(pressedKeys.has('arrowright') || pressedKeys.has('d')) - Number(pressedKeys.has('arrowleft') || pressedKeys.has('a'));
		const vertical = Number(pressedKeys.has('arrowdown') || pressedKeys.has('s')) - Number(pressedKeys.has('arrowup') || pressedKeys.has('w'));
		const inputLength = Math.hypot(horizontal, vertical) || 1;
		const targetVelocityX = horizontal / inputLength * maximumMovementSpeed;
		const targetVelocityY = vertical / inputLength * maximumMovementSpeed;
		velocityX = approachVelocity(velocityX, targetVelocityX, (horizontal ? movementAcceleration : movementFriction) * deltaSeconds);
		velocityY = approachVelocity(velocityY, targetVelocityY, (vertical ? movementAcceleration : movementFriction) * deltaSeconds);
		const speed = Math.hypot(velocityX, velocityY);
		if (speed > maximumMovementSpeed) {
			velocityX = velocityX / speed * maximumMovementSpeed;
			velocityY = velocityY / speed * maximumMovementSpeed;
		}
		if (velocityX || velocityY) {
			const rawX = me.x + velocityX * deltaSeconds;
			const rawY = me.y + velocityY * deltaSeconds;
			let x = Math.max(0.6, Math.min(columns - 0.6, rawX));
			let y = Math.max(0.8, Math.min(rows - 0.8, rawY));
			if (x !== rawX) velocityX = 0;
			if (y !== rawY) velocityY = 0;
			if (wallBlocksMovement(me.x, me.y, x, me.y)) {
				x = me.x;
				velocityX = 0;
			}
			if (wallBlocksMovement(x, me.y, x, y)) {
				y = me.y;
				velocityY = 0;
			}
			presences = presences.map((presence) => presence.id === presenceId ? { ...presence, x, y } : presence);
			if (Date.now() - lastMovementSentAt >= 50 && socket?.readyState === WebSocket.OPEN) {
				lastMovementSentAt = Date.now();
				socket.send(JSON.stringify({ type: 'basecamp-move', x, y }));
			}
		}
		if (horizontal || vertical || velocityX || velocityY)
			movementFrame = requestAnimationFrame(moveAvatar);
		else {
			lastMovementFrameAt = null;
			sendCurrentPosition();
		}
	}

	function approachVelocity(current: number, target: number, amount: number) {
		if (current < target) return Math.min(target, current + amount);
		if (current > target) return Math.max(target, current - amount);
		return target;
	}

	function sendCurrentPosition() {
		const me = presences.find((presence) => presence.id === presenceId);
		if (me && socket?.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify({ type: 'basecamp-move', x: me.x, y: me.y }));
	}

	function revealHud(event: PointerEvent) {
		if (event.pointerType === 'touch') {
			revealedEdge = 'all';
			return;
		}
		const target = event.target as HTMLElement;
		if (target.closest('header,.intro')) return void (revealedEdge = 'top');
		if (target.closest('aside')) return void (revealedEdge = 'right');
		if (target.closest('.setup,.connection,.hint')) return void (revealedEdge = 'bottom');
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		if (y <= 72) revealedEdge = 'top';
		else if (y >= rect.height - 72) revealedEdge = 'bottom';
		else if (x >= rect.width - 72) revealedEdge = 'right';
		else revealedEdge = null;
	}

	function send(message: Record<string, unknown>) {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			notice = { success: false, message: 'Basecamp에 다시 연결하고 있습니다. 잠시만 기다려 주세요.' };
			return null;
		}
		processing = true;
		notice = null;
		const requestId = crypto.randomUUID();
		socket.send(JSON.stringify({ ...message, requestId }));
		return requestId;
	}

	function configure(event: SubmitEvent) {
		event.preventDefault();
		const form = new FormData(event.currentTarget as HTMLFormElement);
		send({
			type: 'basecamp-configure',
			categoryId: form.get('categoryId'),
			accessRoleId: form.get('accessRoleId')
		});
	}

	function createRoom(event: SubmitEvent) {
		event.preventDefault();
		if (!draft) return;
		const form = new FormData(event.currentTarget as HTMLFormElement);
		roomCreationRequestId = send({
			type: 'basecamp-create-room',
			name: form.get('name'),
			...draft
		});
	}

	function updateRoom(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedRoom) return;
		const form = new FormData(event.currentTarget as HTMLFormElement);
		roomEditRequestId = send({
			type: 'basecamp-update-room',
			...selectedRoom,
			name: form.get('name')
		});
	}

	function deleteRoom() {
		if (!selectedRoom) return;
		roomDeletionOpen = true;
	}

	function confirmRoomDeletion() {
		roomDeletionOpen = false;
		if (!selectedRoom) return;
		roomEditRequestId = send({ type: 'basecamp-delete-room', id: selectedRoom.id });
	}

	function cell(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - rect.left) / rect.width) * columns))),
			y: Math.max(0, Math.min(rows - 1, Math.floor(((event.clientY - rect.top) / rect.height) * rows)))
		};
	}

	function beginRoom(event: PointerEvent) {
		if (!building || buildTool === 'eraser' || event.button !== 0) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		start = buildTool === 'wall' ? wallPoint(event) : cell(event);
		end = start;
	}

	function wallPoint(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(columns, Math.round(((event.clientX - rect.left) / rect.width) * columns))),
			y: Math.max(0, Math.min(rows, Math.round(((event.clientY - rect.top) / rect.height) * rows)))
		};
	}

	function beginEditRoom(
		event: PointerEvent,
		room: (typeof data.rooms)[number],
		mode: 'move' | 'resize'
	) {
		if (!building || buildTool !== 'room' || room.status !== 'active' || event.button !== 0) return;
		event.stopPropagation();
		const world = (event.currentTarget as HTMLElement).closest('.world-map') as HTMLElement;
		const current = selectedRoom?.id === room.id ? selectedRoom : room;
		world.setPointerCapture(event.pointerId);
		selectedRoom = { ...current };
		editSession = { mode, pointerId: event.pointerId, origin: cellFromWorld(event, world), initial: { ...current } };
	}

	function cellFromWorld(event: PointerEvent, world: HTMLElement) {
		const rect = world.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - rect.left) / rect.width) * columns))),
			y: Math.max(0, Math.min(rows - 1, Math.floor(((event.clientY - rect.top) / rect.height) * rows)))
		};
	}

	function resizeRoom(event: PointerEvent) {
		if (editSession && (event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
			const point = cell(event);
			const dx = point.x - editSession.origin.x;
			const dy = point.y - editSession.origin.y;
			const room = editSession.initial;
			selectedRoom = editSession.mode === 'move'
				? { ...room, x: Math.max(0, Math.min(columns - room.width, room.x + dx)), y: Math.max(0, Math.min(rows - room.height, room.y + dy)) }
				: { ...room, width: Math.max(2, Math.min(columns - room.x, room.width + dx)), height: Math.max(2, Math.min(rows - room.y, room.height + dy)) };
			return;
		}
		if (!building || !start || !(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId))
			return;
		end = buildTool === 'wall' ? wallPoint(event) : cell(event);
	}

	function finishRoom(event: PointerEvent) {
		if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId))
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
		editSession = null;
		if (building && buildTool === 'wall' && draft) {
			send({ type: 'basecamp-create-wall', ...draft });
			cancelDraft();
		}
	}

	function cancelDraft() {
		start = null;
		end = null;
	}

	function cancelEditing() {
		cancelDraft();
		selectedRoom = null;
		editSession = null;
	}

	const draft = $derived.by(() => {
		if (!start || !end) return null;
		const deltaX = Math.abs(start.x - end.x);
		const deltaY = Math.abs(start.y - end.y);
		if (buildTool === 'wall') {
			if (deltaX === 0 && deltaY === 0) return null;
			return deltaX >= deltaY
				? { x: Math.min(start.x, end.x), y: start.y, width: deltaX, height: 1, orientation: 'horizontal' as const }
				: { x: start.x, y: Math.min(start.y, end.y), width: 1, height: deltaY, orientation: 'vertical' as const };
		}
		return {
			x: Math.min(start.x, end.x),
			y: Math.min(start.y, end.y),
			width: deltaX + 1,
			height: deltaY + 1
		};
	});

	function wallBlocksMovement(fromX: number, fromY: number, toX: number, toY: number) {
		const radius = 0.32;
		return walls.some((wall) => {
			const horizontal = wall.orientation === 'horizontal';
			if (horizontal) {
				const overlaps = toX + radius > wall.x && toX - radius < wall.x + wall.width;
				if (!overlaps || Math.abs(fromY - wall.y) < radius) return false;
				return toY > fromY
					? fromY + radius <= wall.y && toY + radius > wall.y
					: fromY - radius >= wall.y && toY - radius < wall.y;
			}
			const overlaps = toY + radius > wall.y && toY - radius < wall.y + wall.height;
			if (!overlaps || Math.abs(fromX - wall.x) < radius) return false;
			return toX > fromX
				? fromX + radius <= wall.x && toX + radius > wall.x
				: fromX - radius >= wall.x && toX - radius < wall.x;
		});
	}

	function wallStyle(wall: { x: number; y: number; width: number; height: number; orientation?: 'horizontal' | 'vertical' }) {
		return wall.orientation === 'horizontal'
			? `left:${(wall.x / columns) * 100}%;top:${(wall.y / rows) * 100}%;width:${(wall.width / columns) * 100}%`
			: `left:${(wall.x / columns) * 100}%;top:${(wall.y / rows) * 100}%;height:${(wall.height / rows) * 100}%`;
	}

	function setBuildTool(tool: 'room' | 'wall' | 'eraser') {
		if (building && buildTool === tool) building = false;
		else { building = true; buildTool = tool; }
		cancelEditing();
	}

	function deleteWall(event: PointerEvent, wall: (typeof data.walls)[number]) {
		if (!building || buildTool !== 'eraser' || event.button !== 0) return;
		event.stopPropagation();
		send({ type: 'basecamp-delete-wall', id: wall.id });
	}
	const currentRoom = $derived.by(() => {
		const me = presences.find((presence) => presence.id === presenceId);
		if (!me) return null;
		return rooms.find((room) => room.status === 'active' && me.x >= room.x && me.x < room.x + room.width && me.y >= room.y && me.y < room.y + room.height) || null;
	});
	const selectedRoomInvalid = $derived.by(() =>
		selectedRoom
			? rooms.some(
					(room) =>
						room.id !== selectedRoom!.id &&
						(room.status === 'active' || room.status === 'creating') &&
						room.x < selectedRoom!.x + selectedRoom!.width &&
						room.x + room.width > selectedRoom!.x &&
						room.y < selectedRoom!.y + selectedRoom!.height &&
						room.y + room.height > selectedRoom!.y
				)
			: false
	);
	const voiceTarget = $derived(
		currentRoom?.voiceChannelId
			? { name: currentRoom.name, channelId: currentRoom.voiceChannelId }
			: settings?.lobbyChannelId
				? { name: '월드 광장', channelId: settings.lobbyChannelId }
				: null
	);
	const cameraLayout = $derived.by(() => {
		const cellSize = Math.max(28, viewportWidth / columns, viewportHeight / rows) * 1.35 * renderedZoom;
		const mapWidth = columns * cellSize;
		const mapHeight = rows * cellSize;
		const me = presences.find((presence) => presence.id === presenceId);
		const focusX = (me?.x ?? columns / 2) * cellSize;
		const focusY = (me?.y ?? rows / 2) * cellSize;
		const targetX = mapWidth <= viewportWidth
			? (viewportWidth - mapWidth) / 2
			: Math.min(0, Math.max(viewportWidth - mapWidth, viewportWidth / 2 - focusX));
		const targetY = mapHeight <= viewportHeight
			? (viewportHeight - mapHeight) / 2
			: Math.min(0, Math.max(viewportHeight - mapHeight, viewportHeight / 2 - focusY));
		return { mapWidth, mapHeight, targetX, targetY };
	});
	const cameraStyle = $derived(
		`width:${cameraLayout.mapWidth}px;height:${cameraLayout.mapHeight}px;transform:translate3d(${cameraX}px,${cameraY}px,0)`
	);

	$effect(() => {
		const { targetX, targetY } = cameraLayout;
		if (!viewportWidth || !viewportHeight) return;
		if (!cameraInitialized) {
			cameraInitialized = true;
			cameraX = targetX;
			cameraY = targetY;
			return;
		}
		if (zoomFrame !== null) return;
		if (cameraFrame === null) cameraFrame = requestAnimationFrame(animateCamera);
	});

	function animateCamera() {
		cameraFrame = null;
		const dx = cameraLayout.targetX - cameraX;
		const dy = cameraLayout.targetY - cameraY;
		if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
			cameraX = cameraLayout.targetX;
			cameraY = cameraLayout.targetY;
			return;
		}
		cameraX += dx * 0.18;
		cameraY += dy * 0.18;
		cameraFrame = requestAnimationFrame(animateCamera);
	}

	function zoomWorld(event: WheelEvent) {
		event.preventDefault();
		const factor = Math.exp(-event.deltaY * 0.0012);
		targetZoom = Math.max(0.4, Math.min(2.5, targetZoom * factor));
		if (cameraFrame !== null) {
			cancelAnimationFrame(cameraFrame);
			cameraFrame = null;
		}
		if (zoomFrame === null) zoomFrame = requestAnimationFrame(animateZoom);
	}

	function animateZoom() {
		zoomFrame = null;
		const difference = targetZoom - renderedZoom;
		const nextZoom = Math.abs(difference) < 0.001
			? targetZoom
			: renderedZoom + difference * 0.18;
		const ratio = nextZoom / renderedZoom;
		cameraX = viewportWidth / 2 - (viewportWidth / 2 - cameraX) * ratio;
		cameraY = viewportHeight / 2 - (viewportHeight / 2 - cameraY) * ratio;
		renderedZoom = nextZoom;
		if (nextZoom !== targetZoom) zoomFrame = requestAnimationFrame(animateZoom);
	}

	async function moveToVoiceChannel() {
		if (!voiceTarget || !data.guildId || movingToVoiceChannel) return;
		movingToVoiceChannel = true;
		const releaseButton = window.setTimeout(() => {
			movingToVoiceChannel = false;
		}, 1_000);
		const target = voiceTarget;
		const url = `https://discord.com/channels/${data.guildId}/${target.channelId}`;
		try {
			const query = new URLSearchParams(window.location.search);
			const inActivity = query.has('frame_id') && query.has('instance_id');
			if (inActivity && data.discordClientId) {
				const { DiscordSDK } = await import('@discord/embedded-app-sdk');
				const discord = new DiscordSDK(data.discordClientId);
				await discord.ready();
				const result = await discord.commands.openExternalLink({ url });
				if (!result.opened) throw new Error(`Discord가 ${target.name} 채널로 이동하지 못했습니다.`);
			} else {
				window.location.assign(url);
			}
			notice = { success: true, message: `${target.name} 채널로 이동했습니다.` };
		} catch (error) {
			notice = {
				success: false,
				message: error instanceof Error ? error.message : `${target.name} 채널로 이동하지 못했습니다.`
			};
		} finally {
			window.clearTimeout(releaseButton);
			movingToVoiceChannel = false;
		}
	}

	function setAutoVoiceChannel(event: Event) {
		autoMoveVoiceChannel = (event.currentTarget as HTMLInputElement).checked;
		localStorage.setItem(
			`basecamp-auto-move:${data.guildId}`,
			String(autoMoveVoiceChannel)
		);
		if (socket?.readyState === WebSocket.OPEN)
			socket.send(
				JSON.stringify({ type: 'basecamp-auto-move', enabled: autoMoveVoiceChannel })
			);
		else notice = { success: false, message: 'Basecamp에 다시 연결한 뒤 설정해 주세요.' };
	}

	function switchGuild(event: MouseEvent, guildId: string) {
		const query = new URLSearchParams(window.location.search);
		if (!query.has('frame_id') || !query.has('instance_id')) return;
		event.preventDefault();
		query.set('guild', guildId);
		window.location.assign(`/world?${query}`);
	}

	function roomStyle(room: { x: number; y: number; width: number; height: number }) {
		return `left:${(room.x / columns) * 100}%;top:${(room.y / rows) * 100}%;width:${(room.width / columns) * 100}%;height:${(room.height / rows) * 100}%`;
	}
</script>

<svelte:head><title>Mountain Basecamp</title></svelte:head>

<main
	class:reveal-top={revealedEdge === 'top' || revealedEdge === 'all'}
	class:reveal-right={revealedEdge === 'right' || revealedEdge === 'all'}
	class:reveal-bottom={revealedEdge === 'bottom' || revealedEdge === 'all'}
	onpointermove={revealHud}
	onpointerleave={() => { if (revealedEdge !== 'all') revealedEdge = null; }}
>
	<i class="edge-cue top" aria-hidden="true"></i>
	<i class="edge-cue right" aria-hidden="true"></i>
	<i class="edge-cue bottom" aria-hidden="true"></i>
	<header>
		<a class="brand" href="/"><span>M</span>Mountain Basecamp</a>
		{#if data.guilds.length}
			<nav aria-label="서버 선택">
				{#each data.guilds as guild}
					<a class:active={guild.id === data.guildId} href={`/world?guild=${guild.id}`} onclick={(event) => switchGuild(event, guild.id)}>{guild.name}</a>
				{/each}
			</nav>
		{/if}
	</header>

	{#if !data.guildId}
		<section class="empty"><h1>입장할 수 있는 서버가 없습니다</h1><p>Mountain 봇이 있는 Discord 서버에 먼저 참여해 주세요.</p></section>
	{:else}
		<section class="intro">
			<div><small>SERVER WORLD</small><h1>같은 화면에서 걷고, 바로 공간을 바꿉니다.</h1></div>
			{#if data.canManage}
				<div class="build-actions">
					<button class:active={building && buildTool === 'room'} onclick={() => setBuildTool('room')}>방 만들기</button>
					<button class:active={building && buildTool === 'wall'} onclick={() => setBuildTool('wall')}>벽 만들기</button>
					<button class:active={building && buildTool === 'eraser'} onclick={() => setBuildTool('eraser')}>벽 지우기</button>
				</div>
			{/if}
		</section>

		<div class="connection" class:connected><i></i>{connected ? '실시간 연결됨' : '자동 재연결 중'}</div>
		{#if notice}<p class:success={notice.success} class="notice">{notice.message}</p>{/if}

		{#if data.canManage && (!settings?.categoryId || !settings?.accessRoleId)}
			<form class="setup" onsubmit={configure}>
				<div><strong>Discord 연결부터 설정해 주세요</strong><p>새 방의 음성 채널을 만들 카테고리와, 방에서 발언할 월드 접속자 역할입니다.</p></div>
				<label>카테고리<select name="categoryId" required><option value="">선택</option>{#each data.categories as category}<option value={category.id}>{category.name}</option>{/each}</select></label>
				<label>접속자 역할<select name="accessRoleId" required><option value="">선택</option>{#each data.roles as role}<option value={role.id}>@{role.name}</option>{/each}</select></label>
				<button disabled={!connected || processing}>연결 설정 저장</button>
			</form>
		{/if}

		<div class="workspace">
			<div class="world-wrap">
				<div
					class:building
					class:room-building={building && buildTool === 'room'}
					class="world"
					bind:this={worldViewport}
					onwheel={zoomWorld}
				>
					<div
						class="world-map"
						style={cameraStyle}
						role="application"
						aria-label="월드 공간"
						onpointerdown={beginRoom}
						onpointermove={resizeRoom}
						onpointerup={finishRoom}
					>
					<div class="plaza"><span>WORLD PLAZA</span>{#if settings?.lobbyChannelId}<small>🔊 월드 광장</small>{/if}</div>
					{#each walls as wall}
						<div class="wall" class:horizontal={wall.orientation === 'horizontal'} class:vertical={wall.orientation === 'vertical'} class:editable={building && buildTool === 'eraser'} style={wallStyle(wall)} role="button" tabindex={building && buildTool === 'eraser' ? 0 : -1} aria-label="벽 삭제" onpointerdown={(event) => deleteWall(event, wall)}></div>
					{/each}
					{#each rooms as room}
						<div
							class:failed={room.status === 'failed'}
							class:selected={selectedRoom?.id === room.id}
							class:invalid={selectedRoom?.id === room.id && selectedRoomInvalid}
							class="room"
							style={roomStyle(selectedRoom?.id === room.id ? selectedRoom : room)}
							role="button"
							tabindex={building && buildTool === 'room' ? 0 : -1}
							onpointerdown={(event) => beginEditRoom(event, room, 'move')}
							onkeydown={(event) => { if (building && buildTool === 'room' && (event.key === 'Enter' || event.key === ' ')) selectedRoom = { ...room }; }}
						>
							<span>{room.name}</span><small>{room.status === 'active' ? 'VOICE' : room.status}</small>
							{#if building && buildTool === 'room' && room.status === 'active'}<button class="resize-handle" aria-label={`${room.name} 크기 조절`} onpointerdown={(event) => beginEditRoom(event, room, 'resize')}></button>{/if}
						</div>
					{/each}
					{#if draft && buildTool === 'wall'}<div class="wall draft-wall" class:horizontal={draft.orientation === 'horizontal'} class:vertical={draft.orientation === 'vertical'} style={wallStyle(draft)}></div>{:else if draft}<div class:invalid={draft.width < 2 || draft.height < 2} class="room draft" style={roomStyle(draft)}><span>새 방</span><small>{draft.width} × {draft.height}</small></div>{/if}
					{#each presences as presence (presence.id)}
						<div class:mine={presence.id === presenceId} class="avatar" style={`left:${(presence.x / columns) * 100}%;top:${(presence.y / rows) * 100}%`} title={presence.username}>
							{#if presence.avatarUrl}<img src={presence.avatarUrl} alt="" />{:else}<span>{presence.username.slice(0, 1).toUpperCase()}</span>{/if}
							<small>{presence.username}</small>
						</div>
					{/each}
					</div>
				</div>
				<p class="hint">{building ? (buildTool === 'wall' ? '격자선을 따라 드래그해서 벽을 만드세요.' : buildTool === 'eraser' ? '없앨 벽을 누르세요.' : '빈 공간을 드래그해서 방을 그려 보세요.') : '방향키 또는 WASD로 이동 · 휠로 확대/축소'} · {Math.round(targetZoom * 100)}%</p>
			</div>

			<aside>
				{#if selectedRoom && data.canManage}
					<form onsubmit={updateRoom}>
						<small>선택한 공간</small><h2>방 편집하기</h2>
						<label>방 이름<input name="name" maxlength="80" value={selectedRoom.name} required /></label>
						<p>방을 드래그해 이동하고 오른쪽 아래 손잡이로 크기를 조절하세요.</p>
						<p class="room-size">위치 {selectedRoom.x}, {selectedRoom.y} · 크기 {selectedRoom.width} × {selectedRoom.height}</p>
						{#if selectedRoomInvalid}<p class="edit-error">다른 방과 겹치지 않게 배치해 주세요.</p>{/if}
						<button disabled={processing || !connected || selectedRoomInvalid}>변경 저장</button>
						<button class="danger" type="button" disabled={processing || !connected} onclick={deleteRoom}>방과 채널 삭제</button>
						<button class="secondary" type="button" onclick={() => { selectedRoom = null; editSession = null; }}>선택 해제</button>
					</form>
				{:else if draft && buildTool === 'room' && data.canManage}
					<form onsubmit={createRoom}>
						<small>새로운 공간</small><h2>방 확정하기</h2>
						<label>방 이름<input name="name" maxlength="80" placeholder="예: 라운지" required /></label>
						<p>확정하면 <strong>{data.categories.find((item) => item.id === settings?.categoryId)?.name || '설정한 카테고리'}</strong>에 같은 이름의 음성 채널이 생성됩니다.</p>
						<button disabled={processing || !connected || draft.width < 2 || draft.height < 2 || !settings?.categoryId}>방과 채널 만들기</button>
						<button class="secondary" type="button" onclick={cancelDraft}>취소</button>
					</form>
				{:else}
					<div class:room-status={currentRoom} class="guide"><small>{currentRoom ? 'CURRENT ROOM' : 'WORLD LOBBY'}</small><h2>{currentRoom?.name || '월드 광장'}</h2><p>{currentRoom ? '이 방에 들어와 있습니다.' : '아직 어떤 방에도 들어가 있지 않습니다.'}</p>{#if voiceTarget}<div class="voice-status">🔊 현재 공간: {voiceTarget.name}</div><button disabled={movingToVoiceChannel} onclick={moveToVoiceChannel}>{voiceTarget.name} 채널로 이동</button><label class="auto-voice"><input type="checkbox" checked={autoMoveVoiceChannel} onchange={setAutoVoiceChannel} /><span>방 이동 시 통화 자동 이동</span></label>{/if}{#if data.canManage && !currentRoom}<p class="build-tip">방 만들기를 누른 다음 월드 위에서 원하는 크기만큼 드래그하세요.</p>{/if}</div>
				{/if}
			</aside>
		</div>
	{/if}
</main>

<ConfirmDialog
	open={roomDeletionOpen}
	title={`${selectedRoom?.name || '선택한 방'}을 삭제할까요?`}
	description="연결된 Discord 음성 채널도 함께 삭제되며 되돌릴 수 없습니다."
	confirmLabel="방과 채널 삭제"
	danger
	onconfirm={confirmRoomDeletion}
	oncancel={() => (roomDeletionOpen = false)}
/>

<style>
	:global(body){margin:0;background:#0a0d12;color:#f4f2ea;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{min-height:100vh;padding:28px;box-sizing:border-box;background:radial-gradient(circle at 50% 0,#23372d 0,transparent 34%)}header,.intro,.workspace{max-width:1280px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:850;text-decoration:none}.brand span{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#d6ff66;color:#17200d}nav{display:flex;gap:8px;overflow:auto}nav a{padding:8px 12px;border-radius:999px;color:#899187;text-decoration:none;font-size:12px;white-space:nowrap}nav a.active{background:#26312a;color:#e5f2dc}.intro{display:flex;align-items:end;justify-content:space-between;gap:20px;padding:70px 0 28px}.intro small,.guide>small,aside form>small{color:#b4d75c;font-size:10px;font-weight:900;letter-spacing:.16em}.intro h1{max-width:680px;margin:8px 0 0;font-size:clamp(28px,4vw,52px);line-height:1.04}.intro button,.setup button,aside button{border:0;border-radius:12px;background:#d6ff66;color:#15200c;padding:12px 16px;font:inherit;font-weight:850;cursor:pointer}.intro button.active{background:#ffcf72}.intro button:disabled,.setup button:disabled,aside button:disabled{cursor:not-allowed;opacity:.4}.connection{max-width:1240px;margin:0 auto 10px;color:#848c85;font-size:10px;text-align:right}.connection i{display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;background:#9b5c5c}.connection.connected{color:#9eac9c}.connection.connected i{background:#94cf70}.notice{max-width:1240px;margin:0 auto 18px;padding:12px 16px;border:1px solid #663d3d;border-radius:12px;background:#2a1717;color:#ffb6b6;font-size:13px}.notice.success{border-color:#405e38;background:#172619;color:#bfeab6}.setup{max-width:1240px;margin:0 auto 18px;padding:16px 18px;display:grid;grid-template-columns:1fr auto auto auto;align-items:end;gap:14px;border:1px solid #39433a;border-radius:16px;background:#171c18}.setup strong{font-size:14px}.setup p{margin:4px 0 0;color:#8f978e;font-size:11px}.setup label,aside label{display:grid;gap:6px;color:#aeb5ac;font-size:11px}.setup select,aside input{min-width:180px;border:1px solid #3a423b;border-radius:9px;background:#0f1310;color:#fff;padding:10px;font:inherit}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:18px}.world-wrap{min-width:0}.world{position:relative;aspect-ratio:5/3;overflow:hidden;border:1px solid #354039;border-radius:20px;background:#101612;box-shadow:0 24px 80px #0008;touch-action:none;user-select:none}.world-map{position:absolute;top:0;left:0;background-color:#1a251d;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:2.5% 4.1667%;transform-origin:top left;will-change:transform}.world.building .world-map{cursor:crosshair}.plaza{position:absolute;inset:8%;display:grid;place-content:center;justify-items:center;gap:8px;border:1px dashed #44594b;border-radius:50%;color:#ffffff13;font-size:clamp(20px,5vw,68px);font-weight:950;letter-spacing:.15em}.plaza small{color:#9fb09f;font-size:9px;letter-spacing:.08em}.room{position:absolute;display:grid;place-content:center;min-width:0;box-sizing:border-box;border:3px solid transparent;border-radius:8px;background:transparent;color:#fff;text-align:center;pointer-events:none}.world.room-building .room:not(.draft){border-color:#a3c963;background:#4b613fcc;box-shadow:inset 0 0 0 3px #162119}.room span{overflow:hidden;padding:0 5px;font-size:12px;font-weight:850;text-overflow:ellipsis;white-space:nowrap}.room small{color:#d6ff86;font-size:8px;font-weight:900;letter-spacing:.12em}.world.room-building .room.failed{border-color:#a55b5b;background:#572e2ecc}.room.draft{z-index:3;border-color:#a3c963;border-style:dashed;background:#d6ff6633}.room.draft.invalid{border-color:#ff7d7d;background:#ff5d5d22}.avatar{position:absolute;z-index:4;display:grid;place-items:center;width:30px;height:30px;box-sizing:border-box;border:3px solid #88918a;border-radius:50%;background:#566057;color:#fff;font-size:12px;font-weight:900;box-shadow:0 8px 15px #0008;transform:translate(-50%,-50%);transition:left 70ms linear,top 70ms linear}.avatar.mine{border-color:#f8f2da;background:#ee796b;transition:none}.avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}.avatar small{position:absolute;top:32px;max-width:100px;padding:2px 5px;border-radius:4px;background:#0a0d12cc;color:#f4f2ea;font-size:8px;white-space:nowrap}.hint{margin:10px 4px 0;color:#788279;font-size:11px}.voice-status{margin-top:14px;padding:10px;border:1px solid #405e38;border-radius:10px;background:#172619;color:#bfeab6;font-size:11px}.room-status h2{color:#d6ff86}aside{border:1px solid #2e3730;border-radius:18px;background:#141916;padding:20px}aside h2{margin:8px 0 12px;font-size:20px}aside p{color:#8f978f;font-size:12px;line-height:1.65}aside form{display:grid;gap:12px}aside form p{margin:0}aside button.secondary{background:#282f29;color:#b8c0b8}.empty{max-width:720px;margin:120px auto;text-align:center}.empty p{color:#899187}@media(max-width:900px){main{padding:16px}.intro{padding-top:48px;align-items:flex-start;flex-direction:column}.workspace{grid-template-columns:1fr}.setup{grid-template-columns:1fr 1fr}.setup>div{grid-column:1/-1}}@media(max-width:600px){header{align-items:flex-start;flex-direction:column}.setup{grid-template-columns:1fr}.world-wrap{overflow:hidden}.hint{position:sticky;left:0}.intro h1{font-size:30px}}
	:global(html),:global(body){height:100%;overflow:hidden}main{display:flex;height:100dvh;min-height:0;overflow:hidden;flex-direction:column;padding:clamp(10px,2.2vh,24px)}header,.intro,.workspace,.setup,.notice,.connection{width:100%;box-sizing:border-box}header{flex:none}.intro{flex:none;padding:clamp(12px,2.5vh,24px) 0 clamp(8px,1.5vh,16px)}.intro h1{font-size:clamp(22px,3.2vw,42px)}.connection{flex:none;margin-bottom:6px}.notice{flex:none;margin-bottom:8px;padding:8px 12px}.setup{flex:none;margin-bottom:8px;padding:10px 12px}.workspace{flex:1;min-height:0;grid-template-columns:minmax(0,1fr) clamp(190px,22vw,280px);gap:clamp(8px,1.5vw,18px)}.world-wrap{display:grid;min-width:0;min-height:0;overflow:hidden;grid-template-rows:minmax(0,1fr) auto}.world{width:100%;height:100%;min-width:0;min-height:0;aspect-ratio:auto}.hint{margin:6px 4px 0}aside{min-width:0;min-height:0;overflow:hidden;padding:clamp(10px,1.7vw,20px)}
	@media(max-height:650px){.intro{padding:8px 0}.intro small{display:none}.intro h1{margin:0;font-size:22px}.connection{margin-bottom:4px}.setup p{display:none}.setup{padding:8px 10px}.brand span{width:28px;height:28px}.hint{margin-top:3px}}
	@media(max-width:900px){main{padding:10px}.intro{align-items:center;flex-direction:row;padding:10px 0}.workspace{grid-template-columns:minmax(0,1fr) clamp(170px,28vw,230px)}.setup{grid-template-columns:1fr auto auto auto}.setup>div{grid-column:auto}.setup select{min-width:120px}}
	@media(max-width:600px){header{align-items:center;flex-direction:row}.brand{font-size:12px}nav{max-width:52vw}.intro h1{font-size:18px}.intro small{display:none}.intro button{padding:9px 10px;font-size:11px}.workspace{grid-template-columns:minmax(0,1fr) 150px}.world{min-width:0}.world-wrap{overflow:hidden}aside{padding:9px}aside h2{font-size:15px}.guide p{font-size:10px}.setup{grid-template-columns:1fr 1fr}.setup>div{display:none}.setup button{grid-column:1/-1}.setup select{width:100%;min-width:0;padding:7px}.hint{position:static;font-size:9px}}
	main{position:relative;display:block;padding:0}.workspace{position:absolute;inset:0;display:block;max-width:none}.world-wrap{position:absolute;inset:0;display:block}.world{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0}.plaza{inset:12%}.world-wrap>.hint{position:absolute;z-index:12;left:16px;bottom:14px;margin:0;padding:7px 10px;border:1px solid #ffffff12;border-radius:999px;background:#0a0d12bb;color:#c1c9c0;backdrop-filter:blur(10px);pointer-events:none}header{position:absolute;z-index:20;top:14px;left:14px;width:auto;max-width:calc(100% - 28px);margin:0;padding:8px 10px;border:1px solid #ffffff16;border-radius:14px;background:#0a0d12c7;box-shadow:0 10px 30px #0005;backdrop-filter:blur(14px)}header nav{max-width:min(52vw,520px)}.intro{position:absolute;z-index:19;top:72px;left:14px;width:auto;max-width:calc(100% - 28px);margin:0;padding:9px 10px;align-items:center;border:1px solid #ffffff12;border-radius:14px;background:#111713c7;box-shadow:0 10px 30px #0004;backdrop-filter:blur(14px)}.intro small{display:none}.intro h1{max-width:none;margin:0;font-size:16px;white-space:nowrap}.intro button{margin-left:14px;padding:9px 12px;font-size:12px}.connection{position:absolute;z-index:21;right:18px;bottom:16px;width:auto;margin:0;padding:7px 10px;border:1px solid #ffffff12;border-radius:999px;background:#0a0d12bb;backdrop-filter:blur(10px)}.notice{position:absolute;z-index:24;top:76px;left:50%;width:min(520px,calc(100% - 32px));margin:0;transform:translateX(-50%);box-shadow:0 12px 36px #0008}.setup{position:absolute;z-index:23;right:14px;bottom:60px;width:min(760px,calc(100% - 28px));margin:0;grid-template-columns:1fr auto auto auto;box-shadow:0 18px 50px #0009;backdrop-filter:blur(16px)}aside{position:absolute;z-index:18;right:14px;top:72px;width:min(280px,calc(100% - 28px));max-height:calc(100% - 132px);box-sizing:border-box;background:#0e1410d9;box-shadow:0 18px 50px #0008;backdrop-filter:blur(16px)}
	@media(max-width:700px){header{top:8px;left:8px;max-width:calc(100% - 16px)}header nav{max-width:45vw}.intro{top:62px;left:8px;max-width:calc(100% - 16px)}.intro h1{display:none}.intro button{margin:0}.world-wrap>.hint{left:8px;bottom:8px}.connection{right:8px;bottom:8px}.setup{right:8px;bottom:48px;width:calc(100% - 16px)}aside{top:62px;right:8px;width:min(220px,calc(100% - 16px));max-height:calc(100% - 116px)}.plaza{inset:16%}}
	.guide>.voice-status+button{width:100%;margin-top:10px}.build-tip{margin-top:14px;padding-top:12px;border-top:1px solid #ffffff12}
	header,.intro,aside,.setup,.connection,.world-wrap>.hint{opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}header,.intro{transform:translateY(-10px)}aside{transform:translateX(12px)}.setup,.connection,.world-wrap>.hint{transform:translateY(10px)}main.reveal-top header,main.reveal-top .intro,header:focus-within,header:hover,.intro:focus-within,.intro:hover{opacity:1;transform:none;pointer-events:auto}main.reveal-right aside,aside:focus-within,aside:hover{opacity:1;transform:none;pointer-events:auto}main.reveal-bottom .setup,main.reveal-bottom .connection,main.reveal-bottom .world-wrap>.hint,.setup:focus-within,.setup:hover,.connection:hover{opacity:1;transform:none;pointer-events:auto}.edge-cue{position:absolute;z-index:17;display:block;pointer-events:none;opacity:.38;background:#d6ff66;box-shadow:0 0 12px #d6ff6688}.edge-cue.top{top:0;left:50%;width:52px;height:2px;transform:translateX(-50%)}.edge-cue.right{top:50%;right:0;width:2px;height:52px;transform:translateY(-50%)}.edge-cue.bottom{bottom:0;left:50%;width:52px;height:2px;transform:translateX(-50%)}main.reveal-top .edge-cue.top,main.reveal-right .edge-cue.right,main.reveal-bottom .edge-cue.bottom{opacity:0}
	@media(hover:none){header,.intro,aside,.setup,.connection,.world-wrap>.hint{opacity:1;transform:none;pointer-events:auto}.edge-cue{display:none}}
	.auto-voice{display:flex!important;align-items:center;gap:8px;margin-top:10px;padding:8px 2px;color:#aeb5ac;font-size:10px;cursor:pointer}.auto-voice input{min-width:0;width:14px;height:14px;margin:0;accent-color:#d6ff66}
	.world.room-building .room:not(.draft){pointer-events:auto;cursor:move}.world.room-building .room.selected{z-index:5;border-color:#ffcf72;box-shadow:0 0 0 3px #ffcf7244,inset 0 0 0 3px #162119}.resize-handle{position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;padding:0;border:2px solid #17200d;border-radius:4px;background:#ffcf72;cursor:nwse-resize}.resize-handle:focus-visible{outline:2px solid #fff}.room-size{padding:8px;border-radius:8px;background:#ffffff08;color:#c6cec5!important}.danger{background:#5d2929!important;color:#ffd1d1!important}
	.world.room-building .room.selected.invalid{border-color:#ff7777;background:#642f2fcc}.edit-error{margin:0;color:#ff9f9f!important}
	.build-actions{display:flex;gap:8px}.wall{position:absolute;z-index:3;border-radius:999px;background:#7f8877;box-shadow:0 2px 5px #000b,0 0 0 1px #151913;pointer-events:none}.wall.horizontal{height:6px;transform:translateY(-50%)}.wall.vertical{width:6px;transform:translateX(-50%)}.wall.editable{z-index:6;pointer-events:auto;cursor:pointer}.wall.editable::after{position:absolute;content:""}.wall.horizontal.editable::after{inset:-8px 0}.wall.vertical.editable::after{inset:0 -8px}.wall.editable:hover{background:#ff7777}.draft-wall{z-index:7;background:#d6ff66;box-shadow:0 0 0 2px #d6ff6644;pointer-events:none}
</style>
