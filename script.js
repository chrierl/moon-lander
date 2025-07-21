// Utility functions
function randint(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uniform(min, max) {
    return Math.random() * (max - min) + min;
}

function choice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function loadHighScores() {
    const data = localStorage.getItem('highScores');
    return data ? JSON.parse(data) : [];
}

function saveHighScores(scores) {
    localStorage.setItem('highScores', JSON.stringify(scores));
}

// Keyboard key codes (simulating pygame keys)
const pygame = {
    K_LEFT: 37,
    K_RIGHT: 39,
    K_SPACE: 32,
    K_UP: 38,
    K_ESCAPE: 27,
    K_RETURN: 13,
    K_BACKSPACE: 8,
    K_R: 82
};

// Canvas setup
const canvas = document.getElementById('gameCanvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const ctx = canvas.getContext('2d');

// Settings
class Settings {
    constructor() {
        this.hilliness = 100;
        this.initial_time = 20.0;
        this.initial_fuel = 15;
        this.max_vertical_vel = 1.0;
        this.max_horizontal_vel = 1.0;
        this.max_landing_angle = 8;
        this.gravity = 0.03;
        this.max_peak_height_percent = 0.9;
        this.min_valley_height_percent = 0.02;
        this.max_zoom_level = 5.0;
        this.zoom_start_height = 300;
        this.debug = false;
        this.music_list = ["music/lunar_descent.mp3", "music/lunar_reflections.mp3", "music/lunar_surface.mp3"];
        this.lander_fixed_size_percent = 0.01;
        this.minimum_landing_zone_percent = 1.5;
        this.landing_height_tolerance = 10;  // Increased tolerance for landing on flat ground
    }
}

// Generate terrain
function generateTerrain(settings, landerLegSpan) {
    const points = [];
    const landingZones = [];
    let x = 0;
    const minY = HEIGHT - (HEIGHT * settings.max_peak_height_percent);
    const maxY = HEIGHT - (HEIGHT * settings.min_valley_height_percent);
    const initialMin = Math.floor(HEIGHT * 0.166);
    const initialMax = Math.floor(HEIGHT * 0.333);
    points.push([0, HEIGHT - randint(initialMin, initialMax)]);
    const minFlatWidth = landerLegSpan * settings.minimum_landing_zone_percent;
    while (x < WIDTH) {
        const isFlat = Math.random() < 0.1;
        let segment;
        if (isFlat) {
            segment = Math.max(randint(20, 50), Math.floor(minFlatWidth));
        } else {
            segment = randint(20, 50);
        }
        x += segment;
        if (x > WIDTH) x = WIDTH;
        let y;
        if (isFlat) {
            y = points[points.length - 1][1];
            const lastZone = landingZones[landingZones.length - 1];
            if (lastZone && lastZone.x2 === points[points.length - 1][0] && lastZone.y === y) {
                lastZone.x2 = x;
            } else {
                landingZones.push({x1: points[points.length - 1][0], x2: x, y: y, factor: 0});
            }
        } else {
            let dy = randint(-settings.hilliness, settings.hilliness);
            while (dy === 0) dy = randint(-settings.hilliness, settings.hilliness);
            y = points[points.length - 1][1] + dy;
            y = Math.max(minY, Math.min(y, maxY));
        }
        points.push([x, y]);
    }

    // Assign factors
    landingZones.forEach(zone => {
        const width = zone.x2 - zone.x1;
        let baseFactor = (width < 25) ? 2.0 : ((width < 35) ? 1.5 : 1.0);
        const heightBonus = (zone.y - minY) / (maxY - minY) * 0.5;
        zone.factor = baseFactor + heightBonus;
    });

    return {points, landingZones};
}

// Ensure at least one landing zone
function generateValidTerrain(settings, landerLegSpan) {
    let terrainData;
    do {
        terrainData = generateTerrain(settings, landerLegSpan);
    } while (terrainData.landingZones.length === 0);
    return terrainData;
}

// Terrain height
function getTerrainHeight(x, terrainPoints) {
    for (let i = 0; i < terrainPoints.length - 1; i++) {
        const [x1, y1] = terrainPoints[i];
        const [x2, y2] = terrainPoints[i + 1];
        if (x1 <= x && x <= x2) {
            const frac = (x2 - x1 > 0) ? (x - x1) / (x2 - x1) : 0;
            return y1 + frac * (y2 - y1);
        }
    }
    return HEIGHT;
}

// Terrain slope
function getTerrainSlope(x, terrainPoints) {
    for (let i = 0; i < terrainPoints.length - 1; i++) {
        const [x1, y1] = terrainPoints[i];
        const [x2, y2] = terrainPoints[i + 1];
        if (x1 <= x && x <= x2) {
            return (x2 - x1 > 0) ? (y2 - y1) / (x2 - x1) : 0;
        }
    }
    return 0;
}

// World to screen
function worldToScreen(wx, wy, cameraX, cameraY, zoom) {
    return [(wx - cameraX) * zoom, (wy - cameraY) * zoom];
}

class Lander {
    constructor(settings) {
        this.x = uniform(200, WIDTH - 200);
        this.y = 50;
        this.vx = uniform(-0.5, 1.5);
        this.vy = 0;
        this.angle = 0;
        this.fuel = settings.initial_fuel;
        this.thrustPower = 0.1;
        this.rotSpeed = 3.0;
        this.size = 20; // Overridden later
        this.landed = false;
        this.crashed = false;
        this.thrusting = false;
        this.factor = 1.0;
        this.finalVy = 0;
        this.finalVx = 0;
        this.finalAngle = 0;
        this.finalFuel = 0;
        this.crashMessage = null;
        this.needsInitials = false;
        this.highScoreEntered = false;
        this.initials = "";
        this.settings = settings;
        this.score = 0;
    }

    update(keys) {
        if (this.landed || this.crashed) return;

        this.vy += this.settings.gravity;

        if (keys.has(pygame.K_LEFT)) this.angle -= this.rotSpeed;
        if (keys.has(pygame.K_RIGHT)) this.angle += this.rotSpeed;

        this.thrusting = false;
        if ((keys.has(pygame.K_SPACE) || keys.has(pygame.K_UP)) && this.fuel > 0) {
            this.thrusting = true;
            const rad = this.angle * Math.PI / 180;
            this.vx += this.thrustPower * Math.sin(rad);
            this.vy -= this.thrustPower * Math.cos(rad);
            this.fuel -= 0.05;
            if (this.fuel < 0) this.fuel = 0;
        }

        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0) {
            this.x = 0;
            this.vx = 0;
        }
        if (this.x > WIDTH) {
            this.x = WIDTH;
            this.vx = 0;
        }
    }

    getLegPositions() {
        const leg1End = [-this.size * 1.5, this.size * 1.2];
        const leg2End = [this.size * 1.5, this.size * 1.2];
        const leg1Rot = this.rotatePoint(...leg1End);
        const leg2Rot = this.rotatePoint(...leg2End);
        const leg1X = this.x + leg1Rot[0];
        const leg1Y = this.y + leg1Rot[1];
        const leg2X = this.x + leg2Rot[0];
        const leg2Y = this.y + leg2Rot[1];
        return {leg1: [leg1X, leg1Y], leg2: [leg2X, leg2Y]};
    }

    checkCollision(terrainPoints, landingZones) {
        const terrainYCenter = getTerrainHeight(this.x, terrainPoints);
        if (this.y < terrainYCenter - this.size) return;

        const legPositions = this.getLegPositions();
        const [leg1X, leg1Y] = legPositions.leg1;
        const [leg2X, leg2Y] = legPositions.leg2;
        const terrainYLeg1 = getTerrainHeight(leg1X, terrainPoints);
        const terrainYLeg2 = getTerrainHeight(leg2X, terrainPoints);
        const slope = getTerrainSlope(this.x, terrainPoints);
        const effectiveAngle = (((this.angle % 360) + 180) % 360 - 180);
        let isOnPad = false;
        let factor = 1.0;
        for (let zone of landingZones) {
            if (zone.x1 <= Math.min(leg1X, leg2X) && zone.x2 >= Math.max(leg1X, leg2X)) {
                isOnPad = true;
                factor = zone.factor;
                break;
            }
        }
        if (leg1Y >= terrainYLeg1 && leg2Y >= terrainYLeg2 && Math.abs(terrainYLeg1 - terrainYLeg2) < this.settings.landing_height_tolerance && this.vy < this.settings.max_vertical_vel && Math.abs(this.vx) < this.settings.max_horizontal_vel && Math.abs(effectiveAngle) < this.settings.max_landing_angle && Math.abs(slope) < 0.05 && isOnPad) {
            this.landed = true;
            this.vx = 0;
            this.vy = 0;
            this.factor = factor;
            this.finalVy = this.vy;
            this.finalVx = this.vx;
            this.finalAngle = effectiveAngle;
            this.finalFuel = this.fuel;
            const avgTerrain = (terrainYLeg1 + terrainYLeg2) / 2;
            const legAvgYOffset = (leg1Y - this.y + leg2Y - this.y) / 2;
            this.y = avgTerrain - legAvgYOffset;
        } else {
            this.crashed = true;
        }
    }

    rotatePoint(px, py) {
        const rad = this.angle * Math.PI / 180;
        const qx = px * Math.cos(rad) - py * Math.sin(rad);
        const qy = px * Math.sin(rad) + py * Math.cos(rad);
        return [qx, qy];
    }

    draw(ctx, cameraX, cameraY, zoom) {
        // Descent stage base
        const basePoints = [
            [-this.size, this.size / 2],
            [this.size, this.size / 2],
            [this.size / 1.5, 0],
            [-this.size / 1.5, 0]
        ];
        // Ascent stage
        const ascentPoints = [
            [-this.size / 1.5, 0],
            [this.size / 1.5, 0],
            [this.size / 2, -this.size],
            [-this.size / 2, -this.size]
        ];
        // Legs
        const leg1Start = [-this.size / 1.5, this.size / 2];
        const leg1Mid = [-this.size * 1.2, this.size];
        const leg1End = [-this.size * 1.5, this.size * 1.2];
        const leg2Start = [this.size / 1.5, this.size / 2];
        const leg2Mid = [this.size * 1.2, this.size];
        const leg2End = [this.size * 1.5, this.size * 1.2];

        const transformPoints = (points) => points.map(([px, py]) => {
            const [qx, qy] = this.rotatePoint(px, py);
            return worldToScreen(this.x + qx, this.y + qy, cameraX, cameraY, zoom);
        });

        // Draw base
        ctx.beginPath();
        const baseT = transformPoints(basePoints);
        ctx.moveTo(baseT[0][0], baseT[0][1]);
        for (let i = 1; i < baseT.length; i++) ctx.lineTo(baseT[i][0], baseT[i][1]);
        ctx.closePath();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw ascent
        ctx.beginPath();
        const ascentT = transformPoints(ascentPoints);
        ctx.moveTo(ascentT[0][0], ascentT[0][1]);
        for (let i = 1; i < ascentT.length; i++) ctx.lineTo(ascentT[i][0], ascentT[i][1]);
        ctx.closePath();
        ctx.stroke();

        // Draw legs
        const leg1StartT = transformPoints([leg1Start])[0];
        const leg1MidT = transformPoints([leg1Mid])[0];
        const leg1EndT = transformPoints([leg1End])[0];
        ctx.beginPath();
        ctx.moveTo(leg1StartT[0], leg1StartT[1]);
        ctx.lineTo(leg1MidT[0], leg1MidT[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(leg1MidT[0], leg1MidT[1]);
        ctx.lineTo(leg1EndT[0], leg1EndT[1]);
        ctx.stroke();

        const leg2StartT = transformPoints([leg2Start])[0];
        const leg2MidT = transformPoints([leg2Mid])[0];
        const leg2EndT = transformPoints([leg2End])[0];
        ctx.beginPath();
        ctx.moveTo(leg2StartT[0], leg2StartT[1]);
        ctx.lineTo(leg2MidT[0], leg2MidT[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(leg2MidT[0], leg2MidT[1]);
        ctx.lineTo(leg2EndT[0], leg2EndT[1]);
        ctx.stroke();

        // Thrust
        if (this.thrusting && this.fuel > 0) {
            const thrustBaseLeft = [-this.size / 4, this.size / 2];
            const thrustBaseRight = [this.size / 4, this.size / 2];
            const thrustTip = [0, this.size / 2 + this.size * 1.5];
            const thrustT = transformPoints([thrustBaseLeft, thrustBaseRight, thrustTip]);
            ctx.beginPath();
            ctx.moveTo(thrustT[0][0], thrustT[0][1]);
            ctx.lineTo(thrustT[1][0], thrustT[1][1]);
            ctx.lineTo(thrustT[2][0], thrustT[2][1]);
            ctx.closePath();
            ctx.stroke();
        }

        // Debug bounding box
        if (this.settings.debug) {
            const allLocalPoints = [...basePoints, ...ascentPoints, ...[leg1Start, leg1Mid, leg1End, leg2Start, leg2Mid, leg2End]];
            const rotated = allLocalPoints.map(p => this.rotatePoint(...p));
            const worldPoints = rotated.map(r => [this.x + r[0], this.y + r[1]]);
            const minX = Math.min(...worldPoints.map(p => p[0]));
            const minY = Math.min(...worldPoints.map(p => p[1]));
            const maxX = Math.max(...worldPoints.map(p => p[0]));
            const maxY = Math.max(...worldPoints.map(p => p[1]));
            const topLeft = worldToScreen(minX, minY, cameraX, cameraY, zoom);
            const bottomRight = worldToScreen(maxX, maxY, cameraX, cameraY, zoom);
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 1;
            ctx.strokeRect(topLeft[0], topLeft[1], bottomRight[0] - topLeft[0], bottomRight[1] - top_left[1]);
        }
    }
}

const settings = new Settings();
const landerSize = HEIGHT * settings.lander_fixed_size_percent;
const landerLegSpan = landerSize * 3.0;
let terrainData = generateTerrain(settings, landerLegSpan);
let terrain = terrainData.points;
let landingZones = terrainData.landingZones;
let lander = new Lander(settings);
lander.size = landerSize;
let timer = settings.initial_time;
let running = true;

let highScores = loadHighScores();

const insultPrefixes = ["You fool,", "Idiot pilot,", "Clumsy commander,", "Reckless rookie,", "Incompetent astronaut,"];
const insultSuffixes = ["you destroyed the lander!", "mission failed miserably!", "back to flight school!", "what a disaster!", "you call that flying?"];

let music;
if (settings.music_list.length > 0) {
    music = new Audio(choice(settings.music_list));
    music.loop = true;
    music.play().catch(error => console.error("Music playback failed:", error));
}

let keys = new Set();

document.addEventListener('keydown', e => keys.add(e.keyCode));
document.addEventListener('keyup', e => keys.delete(e.keyCode));

document.addEventListener('keypress', e => {
    if (lander.landed && lander.needsInitials) {
        if (e.key === 'Backspace') {
            lander.initials = lander.initials.slice(0, -1);
        } else if (/^[a-zA-Z]$/.test(e.key) && lander.initials.length < 3) {
            lander.initials += e.key.toUpperCase();
        }
    }
});

function resetGame() {
    const landerSize = HEIGHT * settings.lander_fixed_size_percent;
    const landerLegSpan = landerSize * 3.0;
    terrainData = generateTerrain(settings, landerLegSpan);
    terrain = terrainData.points;
    landingZones = terrainData.landingZones;
    lander = new Lander(settings);
    lander.size = landerSize;
    timer = settings.initial_time;
    if (settings.music_list.length > 0) {
        music.src = choice(settings.music_list);
        music.play().catch(error => console.error("Music playback failed:", error));
    }
    keys.clear();  // Clear keys on reset
}

document.addEventListener('keydown', e => {
    if (e.keyCode === pygame.K_RETURN && lander.landed && lander.needsInitials && lander.initials.length === 3) {
        highScores.push({initials: lander.initials, score: lander.score});
        highScores = highScores.sort((a, b) => b.score - a.score).slice(0, 10);
        saveHighScores(highScores);
        lander.needsInitials = false;
        lander.highScoreEntered = true;
    } else if (e.keyCode === pygame.K_R && (lander.landed || lander.crashed)) {
        resetGame();
    } else if (e.keyCode === pygame.K_ESCAPE) {
        running = false;
    } else if (e.keyCode === pygame.K_BACKSPACE && lander.landed && lander.needsInitials) {
        lander.initials = lander.initials.slice(0, -1);
    }
});

function gameLoop() {
    if (!running) return;

    lander.update(keys);

    lander.checkCollision(terrain, landingZones);

    if (!lander.landed && !lander.crashed) {
        timer -= 1 / 60;
        if (timer <= 0) {
            timer = 0;
            lander.crashed = true;
        }
    }

    if (lander.landed && !lander.score) {
        lander.fuelScore = (lander.finalFuel / settings.initial_fuel) * 100;
        lander.timeScore = (timer / settings.initial_time) * 100;
        lander.vyScore = (1 - lander.finalVy / settings.max_vertical_vel) * 100;
        lander.vxScore = (1 - Math.abs(lander.finalVx) / settings.max_horizontal_vel) * 100;
        lander.angleScore = (1 - Math.abs(lander.finalAngle) / settings.max_landing_angle) * 100;
        lander.score = (lander.fuelScore + lander.timeScore + lander.vyScore + lander.vxScore + lander.angleScore) * lander.factor;
        const minScore = (highScores.length === 10) ? Math.min(...highScores.map(s => s.score)) : 0;
        if (highScores.length < 10 || lander.score > minScore) {
            lander.needsInitials = true;
            lander.initials = "";
        } else {
            lander.highScoreEntered = true;
        }
    }

    let heightAboveGround = getTerrainHeight(lander.x, terrain) - lander.y;
    if (heightAboveGround < 0) heightAboveGround = 0;
    const fraction = Math.max(0, (settings.zoom_start_height - heightAboveGround) / settings.zoom_start_height);
    const zoom = 1 + (settings.max_zoom_level - 1) * fraction;
    const visibleWidth = WIDTH / zoom;
    const visibleHeight = HEIGHT / zoom;
    let cameraX = lander.x - visibleWidth / 2;
    let cameraY = lander.y - visibleHeight / 2;
    if (cameraX < 0) cameraX = 0;
    if (cameraX + visibleWidth > WIDTH) cameraX = WIDTH - visibleWidth;
    if (cameraY < 0) cameraY = 0;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Draw terrain
    ctx.beginPath();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    const transformedTerrain = terrain.map(p => worldToScreen(p[0], p[1], cameraX, cameraY, zoom));
    ctx.moveTo(transformedTerrain[0][0], transformedTerrain[0][1]);
    for (let i = 1; i < transformedTerrain.length; i++) {
        ctx.lineTo(transformedTerrain[i][0], transformedTerrain[i][1]);
    }
    ctx.stroke();

    // Draw landing zone factors
    landingZones.forEach(zone => {
        const midX = (zone.x1 + zone.x2) / 2;
        ctx.font = `${Math.floor(12 * zoom)}px monospace`;
        ctx.fillStyle = 'white';
        const text = `${zone.factor.toFixed(1)}x`;
        const textWidth = ctx.measureText(text).width;
        const [textPosX, textPosY] = worldToScreen(midX, zone.y - 15, cameraX, cameraY, zoom);
        ctx.fillText(text, textPosX - textWidth / 2, textPosY);
    });

    lander.draw(ctx, cameraX, cameraY, zoom);

    // Draw fuel bar
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, 200, 20);
    const fuelWidth = (lander.fuel / settings.initial_fuel) * 200;
    ctx.fillStyle = 'white';
    ctx.fillRect(10, 10, fuelWidth, 20);

    // Draw info texts
    const vyColor = lander.vy < settings.max_vertical_vel ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
    const vxColor = Math.abs(lander.vx) < settings.max_horizontal_vel ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
    const effectiveAngle = (((lander.angle % 360) + 180) % 360 - 180);
    const angleColor = Math.abs(effectiveAngle) < settings.max_landing_angle ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
    let timerColor = timer > 10 ? 'rgb(0,255,0)' : (timer >= 5 ? 'rgb(255,165,0)' : 'rgb(255,0,0)');

    ctx.font = '12px monospace';
    ctx.fillStyle = vyColor;
    ctx.fillText(`Vert Vel: ${lander.vy.toFixed(2)}`, 10, 40);
    ctx.fillStyle = vxColor;
    ctx.fillText(`Horiz Vel: ${lander.vx.toFixed(2)}`, 10, 55);
    ctx.fillStyle = angleColor;
    ctx.fillText(`Angle: ${effectiveAngle.toFixed(2)}`, 10, 70);
    ctx.fillStyle = timerColor;
    ctx.fillText(`Time: ${timer.toFixed(1)}`, 10, 85);

    // Display status
    if (lander.landed) {
        if (lander.needsInitials) {
            ctx.font = '20px sans-serif';
            ctx.fillStyle = 'white';
            ctx.fillText("Enter your initials (3 letters):", WIDTH / 2 - 150, 150);
            ctx.fillText(lander.initials, WIDTH / 2 - 50, 180);
        } else {
            ctx.font = '20px sans-serif';
            ctx.fillStyle = 'white';
            ctx.fillText("Landed Safely!", WIDTH / 2 - 100, 150);
            ctx.fillText("Congratulations Commander for a good landing!", WIDTH / 2 - 250, 180);
            ctx.fillText(`Score: ${Math.floor(lander.score)}`, WIDTH / 2 - 100, 210);
            ctx.fillText("Press R to restart", WIDTH / 2 - 100, 240);
            // High scores
            ctx.fillText("High Scores:", WIDTH / 2 - 100, 270);
            let yPos = 300;
            ctx.font = '12px monospace';
            highScores.forEach((hs, i) => {
                ctx.fillText(`${i+1}. ${hs.initials} - ${Math.floor(hs.score)}`, WIDTH / 2 - 100, yPos);
                yPos += 20;
            });
        }
    } else if (lander.crashed) {
        if (!lander.crashMessage) lander.crashMessage = choice(insultPrefixes) + " " + choice(insultSuffixes);
        ctx.font = '20px sans-serif';
        ctx.fillStyle = 'white';
        ctx.fillText("Crashed!", WIDTH / 2 - 100, 150);
        ctx.fillText(lander.crashMessage, WIDTH / 2 - 150, 180);
        ctx.fillText("Press R to restart", WIDTH / 2 - 100, 210);
        // High scores
        ctx.fillText("High Scores:", WIDTH / 2 - 100, 240);
        let yPos = 270;
        ctx.font = '12px monospace';
        highScores.forEach((hs, i) => {
            ctx.fillText(`${i+1}. ${hs.initials} - ${Math.floor(hs.score)}`, WIDTH / 2 - 100, yPos);
            yPos += 20;
        });
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();