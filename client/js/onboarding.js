import {
  buildSpriteSheetFromFile,
  buildSpriteSheetFromUrl,
  drawSpriteFrame,
  loadSpriteSheetAsset
} from "./spriteGen.js";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);

const NAME_ADJECTIVES = [
  "Wandering",
  "Cosmic",
  "Mossy",
  "Tiny",
  "Starry",
  "Lucky",
  "Pocket",
  "Glowing"
];

const NAME_ANIMALS = [
  "Ferret",
  "Penguin",
  "Fox",
  "Otter",
  "Moth",
  "Salamander",
  "Badger",
  "Dragon"
];

export class OnboardingController {
  constructor({ bootstrap, onEnterWorld }) {
    this.bootstrap = bootstrap;
    this.onEnterWorld = onEnterWorld;

    this.elements = {
      landingScreen: document.getElementById("landingScreen"),
      nameInput: document.getElementById("nameInput"),
      randomNameButton: document.getElementById("randomNameButton"),
      fileInput: document.getElementById("fileInput"),
      browseButton: document.getElementById("browseButton"),
      uploadDropzone: document.getElementById("uploadDropzone"),
      defaultBuddyGrid: document.getElementById("defaultBuddyGrid"),
      previewSceneCanvas: document.getElementById("previewSceneCanvas"),
      previewSpriteCanvas: document.getElementById("previewSpriteCanvas"),
      enterWorldButton: document.getElementById("enterWorldButton"),
      enterStatus: document.getElementById("enterStatus"),
      helperButton: document.getElementById("helperButton"),
      helperOverlay: document.getElementById("helperOverlay"),
      closeHelperButton: document.getElementById("closeHelperButton"),
      worldFull: document.getElementById("worldFull"),
      uploadStatus: document.getElementById("uploadStatus"),
      buddyMeta: document.getElementById("parsedBuddyMeta")
    };

    this.state = {
      currentNamePlaceholder: generateFunName(),
      selectedDefaultBuddy: null,
      uploadedFile: null,
      localSpriteSheet: null,
      localWorldSpriteSheet: null,
      processedUpload: null,
      processedUploadPromise: null,
      isProcessingUpload: false,
      previewBuddies: [],
      previewTick: 0,
      isEntering: false
    };
  }

  async init() {
    this.elements.nameInput.placeholder = this.state.currentNamePlaceholder;
    this.elements.nameInput.focus();

    this.renderDefaultBuddyGrid();
    this.attachEvents();
    await this.loadPreviewBuddies();
    this.renderPreviewLoop();
    this.updateEnterState();
  }

  attachEvents() {
    this.elements.randomNameButton.addEventListener("click", () => {
      this.state.currentNamePlaceholder = generateFunName();
      this.elements.nameInput.placeholder = this.state.currentNamePlaceholder;
      if (!this.elements.nameInput.value.trim()) {
        this.elements.nameInput.focus();
      }
      this.updateEnterState();
    });

    this.elements.nameInput.addEventListener("input", () => {
      this.updateEnterState();
    });

    this.elements.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (this.canEnter()) {
          this.handleEnterWorld();
        }
      }
    });

    this.elements.browseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.elements.fileInput.click();
    });

    this.elements.fileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      await this.handleUploadSelection(file, "file picker");
    });

    this.elements.uploadDropzone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      this.elements.uploadDropzone.classList.add("dragover");
    });

    this.elements.uploadDropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.elements.uploadDropzone.classList.add("dragover");
    });

    this.elements.uploadDropzone.addEventListener("dragleave", () => {
      this.elements.uploadDropzone.classList.remove("dragover");
    });

    this.elements.uploadDropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      this.elements.uploadDropzone.classList.remove("dragover");
      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }

      await this.handleUploadSelection(file, "drag and drop");
    });

    this.elements.uploadDropzone.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      this.elements.fileInput.click();
    });

    window.addEventListener("paste", async (event) => {
      if (this.elements.landingScreen.classList.contains("hidden")) {
        return;
      }

      const item = Array.from(event.clipboardData?.items || [])
        .find((entry) => entry.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) {
        return;
      }

      event.preventDefault();
      await this.handleUploadSelection(file, "clipboard paste");
    });

    this.elements.helperButton.addEventListener("click", () => {
      this.elements.helperOverlay.classList.add("open");
      this.elements.helperOverlay.setAttribute("aria-hidden", "false");
    });

    this.elements.closeHelperButton.addEventListener("click", () => {
      this.elements.helperOverlay.classList.remove("open");
      this.elements.helperOverlay.setAttribute("aria-hidden", "true");
    });

    this.elements.enterWorldButton.addEventListener("click", () => {
      this.handleEnterWorld();
    });
  }

  async loadPreviewBuddies() {
    const picks = this.bootstrap.defaultBuddies.slice(0, 3);
    const sheets = await Promise.all(
      picks.map(async (buddy) => ({
        ...buddy,
        sprite: await buildSpriteSheetFromUrl(buddy.url)
      }))
    );
    this.state.previewBuddies = sheets;

    if (!this.state.selectedDefaultBuddy && sheets[0]) {
      await this.selectDefaultBuddy(sheets[0].id);
    }
  }

  renderDefaultBuddyGrid() {
    const grid = this.elements.defaultBuddyGrid;
    grid.innerHTML = "";

    this.bootstrap.defaultBuddies.forEach((buddy) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "default-buddy-button";
      button.dataset.buddyId = buddy.id;
      button.innerHTML = `
        <img src="${buddy.url}" alt="${buddy.label}">
        <div class="buddy-label">${buddy.label}</div>
      `;
      button.addEventListener("click", async () => {
        await this.selectDefaultBuddy(buddy.id);
      });
      grid.append(button);
    });
  }

  async selectDefaultBuddy(buddyId) {
    const buddy = this.bootstrap.defaultBuddies.find((entry) => entry.id === buddyId);
    if (!buddy) {
      return;
    }

    this.state.selectedDefaultBuddy = buddy;
    this.state.uploadedFile = null;
    this.state.processedUpload = null;
    this.state.processedUploadPromise = null;
    this.state.isProcessingUpload = false;
    this.state.localSpriteSheet = await buildSpriteSheetFromUrl(buddy.url);
    this.state.localWorldSpriteSheet = this.state.localSpriteSheet;

    this.elements.fileInput.value = "";
    for (const button of this.elements.defaultBuddyGrid.querySelectorAll(".default-buddy-button")) {
      button.classList.toggle("selected", button.dataset.buddyId === buddyId);
    }

    this.setUploadStatus("Default buddies are aura-free, but they get you in fast.");
    this.renderBuddyMeta(null);
    this.updateEnterState();
    this.drawPreviewSprite();
  }

  async handleUploadSelection(file, source = "upload") {
    console.info("[UPLOAD] File received from", source, file?.name, file?.type, file?.size);

    try {
      await this.selectUploadedFile(file);
    } catch (error) {
      this.state.isProcessingUpload = false;
      console.error("[UPLOAD] Selection failed", error);
      this.setUploadStatus(
        error.message || "Upload failed. Try a cleaner screenshot, or pick a default buddy below.",
        true
      );
      this.updateEnterState();
    } finally {
      this.elements.fileInput.value = "";
      this.elements.uploadDropzone.classList.remove("dragover");
    }
  }

  async selectUploadedFile(file) {
    const validationError = validateUploadFile(file);
    if (validationError) {
      throw new Error(validationError);
    }

    this.state.uploadedFile = file;
    this.state.selectedDefaultBuddy = null;
    this.state.processedUpload = null;
    this.state.processedUploadPromise = null;
    this.state.isProcessingUpload = true;
    this.setUploadStatus("Generating your buddy sprite...");
    this.renderBuddyMeta(null);
    this.updateEnterState();

    for (const button of this.elements.defaultBuddyGrid.querySelectorAll(".default-buddy-button")) {
      button.classList.remove("selected");
    }

    // Step 1: Build local preview immediately from the raw file
    this.state.localSpriteSheet = await buildSpriteSheetFromFile(file);
    this.state.localWorldSpriteSheet = this.state.localSpriteSheet;
    console.info("[UPLOAD] Local preview sprite generated");
    this.drawPreviewSprite();

    // Step 2: Upload to server for processing (with retry for cold-start)
    const currentFile = file;
    let processed;
    try {
      processed = await this.uploadToServer(file);
    } catch (error) {
      console.error("[UPLOAD] Server processing failed", error);
      this.state.isProcessingUpload = false;
      this.setUploadStatus(
        error.message || "Server processing failed. Try again or pick a default buddy.",
        true
      );
      this.updateEnterState();
      return;
    }

    // Abort if user selected a different file while we were uploading
    if (this.state.uploadedFile !== currentFile) {
      return;
    }

    // Step 3: Mark as processed — this unlocks the Enter World button
    this.state.processedUpload = processed;
    this.state.isProcessingUpload = false;

    // Step 4: Show buddy meta (name, rarity, traits) immediately
    this.renderBuddyMeta(processed.buddyMeta, processed.hasRealBuddy);
    this.setUploadStatus(
      processed.hasRealBuddy
        ? `${processed.buddyMeta?.rarityLabel || "Rare"} ${processed.buddyMeta?.species || "buddy"} detected — aura unlocked!`
        : "Custom buddy ready! No rarity aura detected, but your sprite looks great."
    );
    this.updateEnterState();

    // Step 5: Try to load the server-generated sprite for higher quality preview
    // This is optional — if it fails, we still have the local sprite
    try {
      const serverSprite = await loadSpriteSheetAsset(processed.spriteUrl);
      if (this.state.uploadedFile === currentFile) {
        this.state.localWorldSpriteSheet = serverSprite;
        this.drawPreviewSprite();
      }
    } catch (error) {
      console.warn("[UPLOAD] Server sprite load failed, using local preview", error.message);
      // Not a problem — local sprite is fine
    }
  }

  async uploadToServer(file) {
    const formData = new FormData();
    formData.append("buddy", file);

    console.info("[UPLOAD] Sending buddy card to server...");
    const response = await fetchWithRetry("/api/process-sprite", {
      method: "POST",
      body: formData
    });

    console.info("[UPLOAD] Server response status", response.status);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Sprite upload failed." }));
      throw new Error(error.error || "Sprite upload failed.");
    }

    const processed = await response.json();
    console.info("[UPLOAD] Server processed sprite", processed.spriteUrl, processed.buddyMeta?.buddyName);
    return processed;
  }

  getResolvedName() {
    const raw = this.elements.nameInput.value.trim();
    return (raw || this.state.currentNamePlaceholder)
      .replace(/[^a-zA-Z0-9_ ]/g, "")
      .slice(0, 16) || this.state.currentNamePlaceholder;
  }

  canEnter() {
    const hasDefaultBuddy = Boolean(this.state.selectedDefaultBuddy) && Boolean(this.state.localSpriteSheet);
    const hasUploadedBuddy = Boolean(this.state.uploadedFile) && Boolean(this.state.processedUpload);
    return Boolean(this.getResolvedName()) &&
      (hasDefaultBuddy || hasUploadedBuddy) &&
      !this.state.isEntering &&
      !this.state.isProcessingUpload;
  }

  updateEnterState() {
    const canEnter = this.canEnter();
    this.elements.enterWorldButton.disabled = !canEnter;
    if (this.state.isProcessingUpload) {
      this.elements.enterStatus.textContent = "Generating your buddy...";
      return;
    }

    this.elements.enterStatus.textContent = canEnter
      ? `Ready as ${this.getResolvedName()}`
      : "Choose a name and buddy to continue.";
  }

  async handleEnterWorld() {
    if (!this.canEnter()) {
      return;
    }

    this.state.isEntering = true;
    this.elements.enterStatus.textContent = "Entering the world...";
    this.updateEnterState();

    try {
      let sessionPayload;

      if (this.state.uploadedFile && this.state.processedUpload) {
        const processed = this.state.processedUpload;
        if (!this.state.localWorldSpriteSheet && processed.spriteUrl) {
          try {
            this.state.localWorldSpriteSheet = await loadSpriteSheetAsset(processed.spriteUrl);
          } catch {
            // Use local sprite fallback
          }
        }

        sessionPayload = {
          name: this.getResolvedName(),
          spriteHash: processed.spriteHash
        };
      } else {
        sessionPayload = {
          name: this.getResolvedName(),
          defaultBuddyId: this.state.selectedDefaultBuddy.id
        };
      }

      const response = await fetchWithRetry("/api/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(sessionPayload)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unable to create a session." }));
        throw new Error(error.error || "Unable to create a session.");
      }

      const session = await response.json();
      this.onEnterWorld({
        session,
        localSpriteSheet: this.state.localWorldSpriteSheet || this.state.localSpriteSheet,
        displayName: this.getResolvedName()
      });
    } catch (error) {
      this.elements.enterStatus.textContent = error.message || "Unable to enter the world.";
      this.state.isEntering = false;
      this.updateEnterState();
    }
  }

  setUploadStatus(message, isError = false) {
    this.elements.uploadStatus.textContent = message || "";
    this.elements.uploadStatus.className = isError
      ? "status-line upload-status upload-error"
      : "status-line upload-status";
  }

  renderBuddyMeta(meta, hasRealBuddy = false) {
    const root = this.elements.buddyMeta;
    if (!meta) {
      root.classList.add("hidden");
      root.innerHTML = "";
      return;
    }

    root.classList.remove("hidden");
    const name = meta.buddyName || "Buddy";
    const rarity = meta.rarityLabel || "Common";
    const species = meta.species || "buddy";
    const stars = meta.rarityStars || 1;
    const starDisplay = "★".repeat(stars) + "☆".repeat(Math.max(0, 5 - stars));
    const aura = hasRealBuddy ? "Aura unlocked" : "No aura";
    const debugging = meta.stats?.debugging ?? "--";
    const patience = meta.stats?.patience ?? "--";
    const chaos = meta.stats?.chaos ?? "--";
    const wisdom = meta.stats?.wisdom ?? "--";
    const snark = meta.stats?.snark ?? "--";

    root.innerHTML = `
      <div class="parsed-buddy-meta__name">${name}</div>
      <div class="parsed-buddy-meta__rarity">${starDisplay} ${rarity} ${species}</div>
      <div class="parsed-buddy-meta__aura">${hasRealBuddy ? "✨ " : ""}${aura}</div>
      <div class="parsed-buddy-meta__stats">
        <span title="Debugging">🐛 ${debugging}</span>
        <span title="Patience">🧘 ${patience}</span>
        <span title="Chaos">🌀 ${chaos}</span>
        <span title="Wisdom">🦉 ${wisdom}</span>
        <span title="Snark">😏 ${snark}</span>
      </div>
    `;
  }

  renderPreviewLoop() {
    const tick = () => {
      this.state.previewTick += 1;
      this.drawPreviewScene();
      this.drawPreviewSprite();
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  drawPreviewScene() {
    const canvas = this.elements.previewSceneCanvas;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#80c080";
    ctx.fillRect(0, 96, canvas.width, canvas.height - 96);
    ctx.fillStyle = "#6aa46f";
    for (let x = 0; x < canvas.width; x += 20) {
      ctx.fillRect(x, 92 + (x % 40 === 0 ? 0 : 6), 16, 8);
    }

    ctx.fillStyle = "#b39062";
    ctx.fillRect(0, 128, canvas.width, 48);
    ctx.fillStyle = "#dbcc97";
    ctx.fillRect(0, 128, canvas.width, 8);

    const frame = Math.floor(this.state.previewTick / 24) % 2;
    this.state.previewBuddies.forEach((buddy, index) => {
      const offset = 50 + index * 82 + Math.sin(this.state.previewTick / 24 + index) * 12;
      drawSpriteFrame(ctx, buddy.sprite.sheet, "down", frame, offset, 98, 2);
    });
  }

  drawPreviewSprite() {
    const canvas = this.elements.previewSpriteCanvas;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const spriteSheet = this.state.localWorldSpriteSheet || this.state.localSpriteSheet;
    if (!spriteSheet) {
      return;
    }

    const direction = ["down", "left", "right", "up"][Math.floor(this.state.previewTick / 50) % 4];
    const frame = Math.floor(this.state.previewTick / 18) % 2;
    drawSpriteFrame(ctx, spriteSheet.sheet, direction, frame, 16, 16, 3);
  }
}

function generateFunName() {
  const adjective = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const animal = NAME_ANIMALS[Math.floor(Math.random() * NAME_ANIMALS.length)];
  const suffix = Math.floor(Math.random() * 90) + 10;
  return `${adjective}${animal}_${suffix}`;
}

async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      if (attempt === retries) {
        if (error.name === "AbortError") {
          throw new Error("Server took too long. It may be waking up — try again in a few seconds.");
        }
        throw error;
      }
      console.warn(`[UPLOAD] Attempt ${attempt + 1} failed, retrying...`, error.message);
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw new Error("Upload failed after retries.");
}

function validateUploadFile(file) {
  if (!file) {
    return "Choose a PNG, JPG, or GIF buddy image before continuing.";
  }

  if (!SUPPORTED_UPLOAD_TYPES.has(file.type)) {
    return "Please upload a PNG, JPG, or GIF image.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return "Image must be under 2MB.";
  }

  return null;
}
