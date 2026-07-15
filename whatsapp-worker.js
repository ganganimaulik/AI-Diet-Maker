const logsBuffer = [];
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  logsBuffer.push(`[LOG] [${new Date().toISOString()}] ${message}`);
  if (logsBuffer.length > 200) logsBuffer.shift();
  originalLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  logsBuffer.push(`[ERROR] [${new Date().toISOString()}] ${message}`);
  if (logsBuffer.length > 200) logsBuffer.shift();
  originalError.apply(console, args);
};

const { Client, RemoteAuth } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { compilePromptText } = require('./src/lib/compile-prompt.js');
const { computeConfigHash } = require('./src/lib/compute-config-hash.js');

class CustomMongoStore {
  constructor({ mongoose, dataPath } = {}) {
    if (!mongoose) throw new Error('A valid Mongoose instance is required for CustomMongoStore.');
    this.mongoose = mongoose;
    this.dataPath = path.resolve(dataPath || './.wwebjs_auth');
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
  }

  async sessionExists(options) {
    let multiDeviceCollection = this.mongoose.connection.db.collection(`whatsapp-${options.session}.files`);
    let hasExistingSession = await multiDeviceCollection.countDocuments();
    return !!hasExistingSession;   
  }
  
  async save(options) {
    var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`
    });
    const zipPath = path.join(this.dataPath, `${options.session}.zip`);
    await new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(bucket.openUploadStream(`${options.session}.zip`))
        .on('error', err => reject(err))
        .on('close', () => resolve());
    });
    options.bucket = bucket;
    await this.deletePrevious(options);
  }

  async extract(options) {
    var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`
    });
    const dir = path.dirname(options.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Find all files with this name, sort by uploadDate descending to get the latest
    const documents = await bucket.find({
      filename: `${options.session}.zip`
    }).sort({ uploadDate: -1 }).toArray();

    if (documents.length === 0) {
      throw new Error(`Session file not found: ${options.session}.zip`);
    }

    const latestFileId = documents[0]._id;
    console.log(`Extracting latest WhatsApp session file: ${latestFileId} uploaded on ${documents[0].uploadDate}`);

    return new Promise((resolve, reject) => {
      bucket.openDownloadStream(latestFileId)
        .pipe(fs.createWriteStream(options.path))
        .on('error', err => reject(err))
        .on('close', () => resolve());
    });
  }

  async delete(options) {
    var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`
    });
    const documents = await bucket.find({
      filename: `${options.session}.zip`
    }).toArray();

    for (const doc of documents) {
      await bucket.delete(doc._id);
    }
  }

  async deletePrevious(options) {
    const documents = await options.bucket.find({
      filename: `${options.session}.zip`
    }).sort({ uploadDate: -1 }).toArray();
    
    // If there are multiple files, keep only the latest one (index 0) and delete all old ones
    if (documents.length > 1) {
      for (let i = 1; i < documents.length; i++) {
        try {
          await options.bucket.delete(documents[i]._id);
          console.log(`Deleted old WhatsApp session file: ${documents[i]._id} uploaded on ${documents[i].uploadDate}`);
        } catch (err) {
          console.error(`Failed to delete old WhatsApp session file ${documents[i]._id}:`, err);
        }
      }
    }
  }
}

async function resetWhatsAppSession() {
  console.log('Resetting WhatsApp session in DB & local cache...');
  try {
    if (store) {
      await store.delete({ session: 'session' });
      await store.delete({ session: 'RemoteAuth' });
      console.log('Deleted remote WhatsApp session from GridFS.');
    }
  } catch (err) {
    console.error('Failed to delete remote WhatsApp session:', err);
  }
  
  // Clear local directory
  const localPath = path.resolve('./.wwebjs_auth');
  if (fs.existsSync(localPath)) {
    try {
      fs.rmSync(localPath, { recursive: true, force: true });
      console.log('Deleted local .wwebjs_auth directory.');
    } catch (err) {
      console.error('Failed to delete local .wwebjs_auth directory:', err);
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('CRITICAL ERROR: MONGODB_URI environment variable is missing.');
  process.exit(1);
}

// -------------------------------------------------------------
// SCHEMAS DEFINITION
// -------------------------------------------------------------
const WhatsAppStateSchema = new mongoose.Schema({
  status: { type: String, enum: ['disconnected', 'connecting', 'qr_code', 'ready'], default: 'disconnected' },
  qr: { type: String, default: '' },
  connectedPhone: { type: String, default: '' },
  connectedName: { type: String, default: '' }
}, { timestamps: true });

const ContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  isGroup: { type: Boolean, default: false }
}, { timestamps: true });

const SchedulerSchema = new mongoose.Schema({
  isEnabled: { type: Boolean, default: false },
  targetTime: { type: String, default: '14:00' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  recipientType: { type: String, enum: ['contact', 'group'], default: 'contact' },
  recipientId: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  userRecipientType: { type: String, enum: ['contact', 'group'], default: 'contact' },
  userRecipientId: { type: String, default: '' },
  userRecipientName: { type: String, default: '' },
  lastSentDate: { type: String, default: '' },
  lastSentTime: { type: String, default: '' },
  lastError: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  nextRetryTime: { type: Number, default: 0 },
  triggerTest: { type: Boolean, default: false },
  triggerCookTest: { type: Boolean, default: false },
  triggerMyselfTest: { type: Boolean, default: false }
}, { timestamps: true });

const ConfigSchema = new mongoose.Schema({
  apiKey: { type: String, default: '' },
  provider: { type: String, default: 'google-ai-studio' },
  enterpriseAuthMethod: { type: String, default: 'api-key' },
  enterpriseApiKey: { type: String, default: '' },
  enterpriseProjectId: { type: String, default: '' },
  enterpriseLocation: { type: String, default: 'global' },
  enterpriseServiceAccountJson: { type: String, default: '' },
  model: { type: String, default: 'gemini-3.5-flash' },
  customModel: { type: String, default: 'gemini-3.5-flash' },
  thinkingEnabled: { type: Boolean, default: true },
  thinkingBudget: { type: Number, default: 2048 },
  global: {
    dailyCalorieTarget: { type: Number, default: 1600 },
    totalOliveOil: { type: Number, default: 18 },
    oliveOilSplitPercent: { type: Number, default: 50 }
  },
  meals: Array,
  customSplits: Array,
  dailyVariables: Map,
  dailySplits: Map,
  generationRange: { type: String, default: 'all' },
  selectedGenerationDay: { type: String, default: 'MONDAY' },
  huggingFaceToken: { type: String, default: '' },
  huggingFaceSpace: { type: String, default: 'ganganimaulik/diet-maker-worker' }
}, { timestamps: true });

const WhatsAppState = mongoose.models.WhatsAppState || mongoose.model('WhatsAppState', WhatsAppStateSchema);
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);
const Scheduler = mongoose.models.Scheduler || mongoose.model('Scheduler', SchedulerSchema);
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

// Cached Response Schema (AI diet plan cache per day)
const CachedResponseSchema = new mongoose.Schema({
  day: { type: String, required: true },
  configHash: { type: String, required: true },
  responseText: { type: String, default: '' },
  thinkingText: { type: String, default: '' },
  generatedAt: { type: Date, default: Date.now }
}, { timestamps: true });
CachedResponseSchema.index({ day: 1 }, { unique: true });
const CachedResponse = mongoose.models.CachedResponse || mongoose.model('CachedResponse', CachedResponseSchema);

// -------------------------------------------------------------
// INITIALIZE DATABASE & WORKER
// -------------------------------------------------------------
let client;
let store;
let isClientReady = false;
let isShuttingDown = false;
console.log('Connecting to MongoDB...');
mongoose.connect(MONGODB_URI, { bufferCommands: false }).then(async () => {
  console.log('Connected to MongoDB successfully.');
  
  // Reset connection state on startup
  await WhatsAppState.findOneAndUpdate(
    {},
    { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
    { upsert: true }
  );

  // Reset scheduler retry status on startup so we don't wait for cooldowns
  try {
    await Scheduler.findOneAndUpdate(
      {},
      { $set: { retryCount: 0, nextRetryTime: 0 } }
    );
    console.log('Reset scheduler retry status on startup.');
  } catch (err) {
    console.error('Failed to reset scheduler retry status on startup:', err);
  }

  store = new CustomMongoStore({ mongoose: mongoose, dataPath: './.wwebjs_auth' });
  
  // Determine puppeteer executable path
  // On Linux (Docker): if PUPPETEER_EXECUTABLE_PATH is not explicitly set, leave
  // executablePath undefined so puppeteer uses its own downloaded Chrome for Testing.
  // This guarantees version compatibility (puppeteer 24.38 needs Chrome 146, but
  // Debian's system chromium may be a different/incompatible version like 150).
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath && process.platform === 'darwin') {
    const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(macChromePath)) {
      executablePath = macChromePath;
    }
  }
  
  console.log(`Initializing WhatsApp Client (Chrome Path: ${executablePath || 'default'})...`);

  // Build puppeteer args dynamically based on platform
  // Note: --disable-blink-features=AutomationControlled is added automatically by wwebjs Client.js
  const puppeteerArgs = [
    '--no-sandbox', 
    '--disable-setuid-sandbox', 
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--no-first-run',
    '--no-default-browser-check'
  ];

  // Avoid --single-process as it causes crashes/timeouts in many Docker containers
  if (process.platform !== 'darwin') {
    puppeteerArgs.push('--no-zygote');
  }

  client = new Client({
    authStrategy: new RemoteAuth({
      clientId: 'session',
      store: store,
      backupSyncIntervalMs: 120000 // Backup session to DB every 2 mins
    }),
    webVersionCache: {
      type: 'local',
    },
    authTimeoutMs: 180000, // 3 mins — matches protocolTimeout; prevents spurious "auth timeout" on slow containers
    qrMaxRetries: 10, // Give up after 10 QR refreshes instead of looping forever
    takeoverOnConflict: true, // Take over session if another browser (e.g. old container) is still connected
    takeoverTimeoutMs: 30000, // Wait 30s before taking over
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    puppeteer: {
      executablePath: executablePath,
      headless: true,
      args: puppeteerArgs,
      protocolTimeout: 180000, // Wait up to 3 mins for Puppeteer protocol calls
      timeout: 180000, // Page navigation timeout: 3 mins (default 30s is too short for HF Spaces)
    }
  });

  client.on('remote_session_saved', () => {
    console.log('WhatsApp Remote Session saved to MongoDB store successfully.');
  });

  // -------------------------------------------------------------
  // WHATSAPP EVENT HANDLERS
  // -------------------------------------------------------------
  client.on('qr', async (qr) => {
    console.log('WhatsApp QR Code generated.');
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      await WhatsAppState.findOneAndUpdate(
        {},
        { status: 'qr_code', qr: dataUrl, connectedPhone: '', connectedName: '' },
        { upsert: true }
      );
    } catch (err) {
      console.error('Failed to generate QR data URL:', err);
    }
  });

  client.on('ready', async () => {
    if (isClientReady) {
      console.log('WhatsApp Client is READY (already processed, skipping duplicate event).');
      return;
    }
    isClientReady = true;
    console.log('WhatsApp Client is READY!');
    const phone = client.info.wid.user;
    const name = client.info.pushname || 'Connected Device';
    
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'ready', qr: '', connectedPhone: phone, connectedName: name },
      { upsert: true }
    );

    // Sync Contacts in the background
    syncContacts(client);

    // Run an immediate scheduler check once ready (after 5 seconds to let contacts/session stabilize)
    setTimeout(() => {
      console.log('Running immediate startup scheduler check...');
      schedulerCheck(client);
    }, 5000);

    // Force an initial backup after the session stabilizes (60 seconds)
    // This ensures that even if sessionExists was true on startup, we save the refreshed/updated session.
    setTimeout(async () => {
      try {
        if (client && client.authStrategy && typeof client.authStrategy.storeRemoteSession === 'function') {
          console.log('Forcing initial WhatsApp session backup to MongoDB store...');
          await client.authStrategy.storeRemoteSession();
          console.log('Initial WhatsApp session backup completed.');
        }
      } catch (err) {
        console.error('Failed to run initial forced session backup:', err);
      }
    }, 60000);
  });

  client.on('disconnected', async (reason) => {
    console.log('WhatsApp Client disconnected. Reason:', reason);
    isClientReady = false;

    // During graceful shutdown (SIGTERM from HF Spaces redeploy), do NOT wipe the
    // MongoDB session. The shutdown handler has already saved it. Only wipe on
    // genuine disconnections (e.g., user logged out from phone).
    if (isShuttingDown) {
      console.log('Shutdown in progress — preserving WhatsApp session in MongoDB.');
    } else {
      await resetWhatsAppSession();
    }

    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
      { upsert: true }
    );

    // Only exit if this is NOT a managed shutdown (the shutdown handler manages its own exit)
    if (!isShuttingDown) {
      console.log('Exiting worker process to restart and generate new QR code...');
      setTimeout(() => {
        process.exit(1);
      }, 2000);
    }
  });

  client.on('auth_failure', async (msg) => {
    console.error('WhatsApp Authentication Failure:', msg);
    
    // If the process has been running for less than 3 minutes, do not delete the session.
    // It's highly likely an overlapping deployment collision or temporary connectivity issue.
    // Exiting will cause HF to restart the container, by which time the old container will be dead.
    const processUptime = process.uptime();
    if (processUptime < 180) {
      console.warn(`Auth failure occurred during startup (uptime: ${Math.round(processUptime)}s). Retaining session in MongoDB and exiting to allow container restart.`);
    } else {
      console.log('Auth failure occurred after startup. Wiping session.');
      await resetWhatsAppSession();
    }

    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
      { upsert: true }
    );
    console.log('Exiting worker process to restart...');
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`WhatsApp Client Loading: ${percent}% - ${message}`);
  });

  // Initialize with retry logic (exponential backoff)
  const MAX_INIT_RETRIES = 5;
  const BASE_RETRY_DELAY_MS = 30000; // 30 seconds

  async function initializeWithRetry(attempt = 1) {
    try {
      console.log(`WhatsApp client initialization attempt ${attempt}/${MAX_INIT_RETRIES}...`);
      await client.initialize();
      console.log('WhatsApp client initialized successfully.');
    } catch (err) {
      console.error(`Failed to initialize WhatsApp client (attempt ${attempt}/${MAX_INIT_RETRIES}):`, err);

      if (attempt >= MAX_INIT_RETRIES) {
        console.error(`All ${MAX_INIT_RETRIES} initialization attempts failed. Restarting worker process...`);
        // Update state in DB so the frontend knows
        try {
          await WhatsAppState.findOneAndUpdate(
            {},
            { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
            { upsert: true }
          );
        } catch (_) {}
        setTimeout(() => process.exit(1), 2000);
        return;
      }

      // Destroy any leftover browser instance before retrying
      try {
        if (client.pupBrowser) {
          await client.pupBrowser.close();
        }
      } catch (_) {}

      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1); // 30s, 60s, 120s, 240s, 480s
      console.log(`Retrying in ${delay / 1000} seconds...`);
      setTimeout(() => initializeWithRetry(attempt + 1), delay);
    }
  }

  initializeWithRetry();

  // Guard flag to prevent overlapping scheduler executions
  let isSchedulerRunning = false;

  // Start Scheduler Loop (check every 60 seconds)
  setInterval(async () => {
    if (isSchedulerRunning) {
      console.log('Scheduler check skipped — previous execution still in progress.');
      return;
    }
    isSchedulerRunning = true;
    try {
      await schedulerCheck(client);
    } finally {
      isSchedulerRunning = false;
    }
  }, 60000);

}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

// -------------------------------------------------------------
// SYNC WHATSAPP CONTACTS TO MONGODB
// -------------------------------------------------------------
async function syncContacts(client) {
  // Wait for WWebJS bridge to be fully available in the browser context
  await new Promise(resolve => setTimeout(resolve, 10000));

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Fetching WhatsApp chats to cache contacts (attempt ${attempt}/3)...`);
      const chats = await client.getChats();
      console.log(`Fetched ${chats.length} chats. Syncing to database...`);
      
      for (const chat of chats) {
        if (chat.id && chat.name) {
          await Contact.findOneAndUpdate(
            { id: chat.id._serialized },
            { name: chat.name, isGroup: chat.isGroup },
            { upsert: true }
          );
        }
      }
      console.log('WhatsApp contacts synced successfully.');
      return;
    } catch (err) {
      console.error(`Failed to sync contacts (attempt ${attempt}/3):`, err);
      if (attempt < 3) {
        console.log('Retrying contact sync in 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

// -------------------------------------------------------------
// SCHEDULER CHECK & EXECUTION
// -------------------------------------------------------------
async function schedulerCheck(client) {
  try {
    const scheduler = await Scheduler.findOne();
    if (!scheduler) return;

    // 1. Check if a manual Test Send was triggered
    if (scheduler.triggerTest) {
      console.log('Manual Test Send (All) triggered.');
      await Scheduler.findOneAndUpdate({}, { $set: { triggerTest: false } });
      await executeScheduledSend(client, scheduler, true, 'all');
      return;
    }
    if (scheduler.triggerCookTest) {
      console.log('Manual Cook Test Send triggered.');
      await Scheduler.findOneAndUpdate({}, { $set: { triggerCookTest: false } });
      await executeScheduledSend(client, scheduler, true, 'cook');
      return;
    }
    if (scheduler.triggerMyselfTest) {
      console.log('Manual Myself Test Send triggered.');
      await Scheduler.findOneAndUpdate({}, { $set: { triggerMyselfTest: false } });
      await executeScheduledSend(client, scheduler, true, 'myself');
      return;
    }

    // 2. Check if automated sending is enabled
    if (!scheduler.isEnabled) return;

    // 3. Verify recipient configurations
    if (!scheduler.recipientId && !scheduler.userRecipientId) {
      console.warn('Daily Scheduler enabled but both recipientId and userRecipientId are missing.');
      return;
    }

    // 4. Check time and date conditions
    const now = new Date();
    const timezone = scheduler.timezone || 'Asia/Kolkata';
    
    // Format local date: YYYY-MM-DD in target timezone
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    
    // Format local time: HH:MM in target timezone
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    
    const [targetHour, targetMinute] = scheduler.targetTime.split(':');
    const [currHour, currMinute] = localTime.split(':');

    const currHourInt = parseInt(currHour);
    const currMinuteInt = parseInt(currMinute);
    const currTotalMinutes = currHourInt * 60 + currMinuteInt;

    const targetHourInt = parseInt(targetHour);
    const targetMinuteInt = parseInt(targetMinute);
    const targetTotalMinutes = targetHourInt * 60 + targetMinuteInt;

    // Evaluate active window
    const isMorningWindow = currTotalMinutes >= 0 && currTotalMinutes <= 9 * 60 + 30; // 00:00 to 09:30
    const isAfternoonWindow = currTotalMinutes >= 14 * 60 && currTotalMinutes <= 23 * 60 + 59; // 14:00 to 23:59

    if (!isMorningWindow && !isAfternoonWindow) {
      // Outside valid sending windows — skip checking
      return;
    }

    // Ensure the configured targetTime falls in our current active window to trigger sending
    const isTargetTimeInCurrentWindow = (isMorningWindow && targetTotalMinutes >= 0 && targetTotalMinutes <= 9 * 60 + 30) ||
                                       (isAfternoonWindow && targetTotalMinutes >= 14 * 60 && targetTotalMinutes <= 23 * 60 + 59);

    if (!isTargetTimeInCurrentWindow) {
      return;
    }

    // Check if current time is past/equal target time
    const isPastTargetTime = currTotalMinutes >= targetTotalMinutes;

    // If already sent today, skip (unless last send was in the morning before 9 AM, and we are currently in the afternoon window)
    if (scheduler.lastSentDate === localDate) {
      let shouldSkip = true;
      if (isAfternoonWindow && scheduler.lastSentTime) {
        const [lastHourStr, lastMinStr] = scheduler.lastSentTime.split(':');
        const lastHour = parseInt(lastHourStr);
        const lastMinute = parseInt(lastMinStr);
        const lastTotalMinutes = lastHour * 60 + lastMinute;
        
        // If the last message was sent before 9:00 AM today (540 minutes), do not skip (allow afternoon send)
        if (lastTotalMinutes < 9 * 60) {
          shouldSkip = false;
        }
      }
      if (shouldSkip) return;
    }

    if (isPastTargetTime) {
      // Check if we are in a retry cool-down
      if (scheduler.retryCount > 0 && Date.now() < scheduler.nextRetryTime) {
        // Still cooling down from previous failure
        return;
      }

      console.log(`Time match detected! Target: ${scheduler.targetTime}. Current: ${localTime}. Executing scheduled delivery...`);
      await executeScheduledSend(client, scheduler, false);
    }
  } catch (err) {
    console.error('Error in scheduler check loop:', err);
  }
}

// -------------------------------------------------------------
// CORE GENERATION & WHATSAPP TRANSMISSION
// -------------------------------------------------------------
async function executeScheduledSend(client, scheduler, isTest = false, testTarget = 'all') {
  const now = new Date();
  const timezone = scheduler.timezone || 'Asia/Kolkata';
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  
  try {
    // 1. Verify WhatsApp client is connected
    const state = await WhatsAppState.findOne();
    if (!state || state.status !== 'ready') {
      throw new Error('WhatsApp client is not connected / authenticated.');
    }

    // Verify recipient is configured in the scheduler
    if (isTest) {
      if (testTarget === 'cook' && !scheduler.recipientId) {
        throw new Error('Cook Recipient is not configured in the scheduler.');
      }
      if (testTarget === 'myself' && !scheduler.userRecipientId) {
        throw new Error('Myself Recipient is not configured in the scheduler.');
      }
      if (testTarget === 'all' && !scheduler.recipientId && !scheduler.userRecipientId) {
        throw new Error('Neither Cook Recipient nor Myself Recipient is configured in the scheduler.');
      }
    } else {
      if (!scheduler.recipientId && !scheduler.userRecipientId) {
        throw new Error('Neither Cook Recipient nor Myself Recipient is configured in the scheduler.');
      }
    }

    // 2. Fetch active diet configuration
    const configDoc = await Config.findOne();
    if (!configDoc) {
      throw new Error('Diet configuration is missing.');
    }
    const hasEnterpriseCreds = configDoc.provider === 'gemini-enterprise' && (
      configDoc.enterpriseAuthMethod === 'adc' ||
      (configDoc.enterpriseAuthMethod === 'api-key' && (process.env.GEMINI_API_KEY || process.env.API_KEY || configDoc.enterpriseApiKey)) ||
      (configDoc.enterpriseAuthMethod === 'service-account' && configDoc.enterpriseServiceAccountJson)
    );
    const hasStudioCreds = configDoc.provider !== 'gemini-enterprise' && (process.env.GEMINI_API_KEY || process.env.API_KEY || configDoc.apiKey);
    if (!hasEnterpriseCreds && !hasStudioCreds) {
      throw new Error('Gemini API Key or credentials are missing.');
    }

    // 3. Compile prompt for target day
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    const [currHour, currMinute] = localTime.split(':');
    const currHourInt = parseInt(currHour);
    const currMinuteInt = parseInt(currMinute);
    const currTotalMinutes = currHourInt * 60 + currMinuteInt;

    // If afternoon/evening window (after 2 PM / 14:00), we send for tomorrow (the next day)
    let isTomorrow = false;
    if (currTotalMinutes >= 14 * 60 && currTotalMinutes <= 23 * 60 + 59) {
      isTomorrow = true;
    }

    let targetDate = now;
    if (isTomorrow) {
      targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
    const targetDayName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(targetDate).toUpperCase();

    console.log(`Compiling diet prompt for ${isTomorrow ? 'tomorrow' : 'today'} (${targetDayName})...`);
    const prompt = compilePromptText(configDoc, { mode: 'single', selectedDay: targetDayName });

    // 4. Check cache before calling Gemini API
    let generatedText;
    const currentHash = computeConfigHash(configDoc);
    const cachedEntry = await CachedResponse.findOne({ day: targetDayName });

    if (cachedEntry && cachedEntry.configHash === currentHash && cachedEntry.responseText) {
      console.log(`Using cached diet plan for ${targetDayName} (generated at ${cachedEntry.generatedAt.toISOString()}).`);
      generatedText = cachedEntry.responseText;
    } else {
      if (cachedEntry && cachedEntry.configHash !== currentHash) {
        console.log(`Cache for ${targetDayName} is stale (config changed). Regenerating...`);
      }
      console.log('Generating diet plan from Gemini...');
      generatedText = await callGeminiAPI(configDoc, prompt);

      // Save to cache after successful generation
      try {
        await CachedResponse.findOneAndUpdate(
          { day: targetDayName },
          {
            $set: {
              configHash: currentHash,
              responseText: generatedText,
              thinkingText: '',
              generatedAt: new Date()
            }
          },
          { upsert: true }
        );
        console.log(`Cached diet plan for ${targetDayName}.`);
      } catch (cacheErr) {
        console.error('Failed to save to cache (non-fatal):', cacheErr);
      }
    }
    
    // 5. Extract Part 1 (Myself) and Part 2 (Cook instructions)
    const userMessageToSend = extractMyselfInstructions(generatedText, targetDayName);
    const cookMessageToSend = extractCookInstructions(generatedText, targetDayName);

    // 6. Transmit message
    // Verify window.WWebJS is defined before attempting to send
    let isWWebReady = false;
    try {
      if (client && client.pupPage) {
        isWWebReady = await client.pupPage.evaluate(() => typeof window.WWebJS !== 'undefined');
      }
    } catch (err) {
      console.error('Failed to check window.WWebJS state in browser:', err);
    }

    if (!isWWebReady) {
      console.warn('WhatsApp Client: window.WWebJS is undefined in the browser context. Attempting recovery...');
      try {
        if (client && client.pupPage) {
          await client.inject();
          // Force the appStateHasSyncedEvent handler to run to re-evaluate LoadUtils
          await client.pupPage.evaluate(() => {
            if (typeof window.onAppStateHasSyncedEvent === 'function') {
              window.onAppStateHasSyncedEvent();
            }
          });
          
          // Wait up to 5 seconds for re-injection to complete
          let start = Date.now();
          while (Date.now() - start < 5000) {
            isWWebReady = await client.pupPage.evaluate(() => typeof window.WWebJS !== 'undefined').catch(() => false);
            if (isWWebReady) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
      } catch (injectErr) {
        console.error('Failed recovery injection:', injectErr);
      }

      if (!isWWebReady) {
        throw new Error('WhatsApp browser context is broken (window.WWebJS is undefined and recovery failed).');
      } else {
        console.log('WhatsApp Client recovery: window.WWebJS restored successfully!');
      }
    }

    const shouldSendCook = scheduler.recipientId && (!isTest || testTarget === 'cook' || testTarget === 'all');
    const shouldSendMyself = scheduler.userRecipientId && (!isTest || testTarget === 'myself' || testTarget === 'all');

    if (shouldSendCook) {
      console.log(`Sending WhatsApp Cook message to ${scheduler.recipientName || scheduler.recipientId}...`);
      await client.sendMessage(scheduler.recipientId, cookMessageToSend);
      console.log('WhatsApp Cook message sent successfully!');
    }
    if (shouldSendMyself) {
      console.log(`Sending WhatsApp Myself message to ${scheduler.userRecipientName || scheduler.userRecipientId}...`);
      await client.sendMessage(scheduler.userRecipientId, formatMarkdownForWhatsApp(userMessageToSend));
      console.log('WhatsApp Myself message sent successfully!');
    }

    // 7. Update scheduler states on Success
    if (!isTest) {
      const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
      await Scheduler.findOneAndUpdate(
        {},
        {
          $set: {
            lastSentDate: localDate,
            lastSentTime: localTime,
            lastError: '',
            retryCount: 0,
            nextRetryTime: 0
          }
        }
      );
    } else {
      console.log('Test send execution completed successfully.');
    }
  } catch (error) {
    console.error('Failed to execute scheduled send:', error);
    
    const errMsg = error.message || String(error);
    const isBrowserBroken = errMsg.includes('getChat') || 
                            errMsg.includes('window.WWebJS') ||
                            errMsg.includes('browser context is broken') ||
                            errMsg.includes('Protocol error') ||
                            errMsg.includes('Session closed') ||
                            errMsg.includes('Target closed') ||
                            errMsg.includes('Navigation failed');

    if (!isTest) {
      // Set retry fields: retry in 30 minutes
      const retryCount = (scheduler.retryCount || 0) + 1;
      const nextRetryTime = Date.now() + 30 * 60 * 1000; // 30 minutes in the future
      
      await Scheduler.findOneAndUpdate(
        {},
        {
          $set: {
            lastError: errMsg,
            retryCount: retryCount,
            nextRetryTime: nextRetryTime
          }
        }
      );
      console.log(`Scheduler updated with retry status. Attempt #${retryCount}. Next retry: ${new Date(nextRetryTime).toLocaleTimeString()}`);
    }

    if (isBrowserBroken) {
      console.error('CRITICAL: WhatsApp browser context appears broken/disconnected. Exiting worker process to force restart...');
      setTimeout(() => {
        process.exit(1);
      }, 3000);
    }
  }
}

// Helper: Call Google Gemini API
async function callGeminiAPI(c, prompt) {
  const model = c.model === 'custom' ? c.customModel : c.model;
  
  if (c.provider === 'gemini-enterprise') {
    if (c.enterpriseAuthMethod === 'api-key') {
      const enterpriseApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || c.enterpriseApiKey;
      if (!enterpriseApiKey) {
        throw new Error('Agent Platform API Key is required when API Key authentication is selected.');
      }
      if (!c.enterpriseProjectId) {
        throw new Error('GCP Project ID is required for Gemini Enterprise Agent Platform.');
      }

      // Build the request payload for Gemini Enterprise REST API
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
        }
      };

      if (c.thinkingEnabled) {
        payload.generationConfig.thinkingConfig = {
          thinkingBudget: c.thinkingBudget || 2048
        };
      }

      const loc = c.enterpriseLocation || 'global';
      const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
      const endpoint = `https://${host}/v1/projects/${c.enterpriseProjectId}/locations/${loc}/publishers/google/models/${model}:generateContent?key=${enterpriseApiKey}`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini Enterprise API returned error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let text = '';
      for (const part of parts) {
        if (!part.thought && part.text) {
          text += part.text;
        }
      }

      if (!text && parts.length > 0) {
        text = parts.map(p => p.text || '').join('');
      }

      return text;

    } else {
      // Service Account or ADC auth using @google/genai SDK
      if (c.enterpriseAuthMethod === 'service-account' && !c.enterpriseServiceAccountJson) {
        throw new Error('Service Account JSON is required when Service Account authentication is selected.');
      }
      if (!c.enterpriseProjectId) {
        throw new Error('GCP Project ID is required for Gemini Enterprise Agent Platform.');
      }

      const { GoogleGenAI } = require('@google/genai');

      let googleAuthOptions = undefined;
      if (c.enterpriseAuthMethod === 'service-account') {
        try {
          googleAuthOptions = {
            credentials: JSON.parse(c.enterpriseServiceAccountJson)
          };
        } catch (err) {
          throw new Error(`Invalid Service Account JSON: ${err.message}`);
        }
      }

      const ai = new GoogleGenAI({
        vertexai: true,
        project: c.enterpriseProjectId,
        location: c.enterpriseLocation || 'global',
        googleAuthOptions
      });

      const configObj = {
        temperature: 0.1,
      };

      if (c.thinkingEnabled) {
        configObj.thinkingConfig = {
          thinkingBudget: c.thinkingBudget || 2048
        };
      }

      const sdkResponse = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: configObj
      });

      const candidate = sdkResponse.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let text = '';
      for (const part of parts) {
        if (!part.thought && part.text) {
          text += part.text;
        }
      }

      if (!text && parts.length > 0) {
        text = parts.map(p => p.text || '').join('');
      }

      return text;
    }
  } else {
    // Default: Google AI Studio API
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || c.apiKey;
    if (!apiKey) {
      throw new Error('Gemini API Key is missing.');
    }

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
      }
    };

    if (c.thinkingEnabled) {
      payload.generationConfig.thinkingConfig = {
        thinkingBudget: c.thinkingBudget || 2048
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    
    let text = '';
    for (const part of parts) {
      if (!part.thought && part.text) {
        text += part.text;
      }
    }

    if (!text && parts.length > 0) {
      text = parts.map(p => p.text || '').join('');
    }

    return text;
  }
}

// Helper: Extract Part 1 (Myself Instructions) from response markdown
function extractMyselfInstructions(md, dayName) {
  if (!md) return `No plan generated for ${dayName}.`;

  const part1Regex = /(?:###?\s*)?PART\s*1:\s*FOR\s*MYSELF[^\n]*/i;
  const part2Regex = /(?:###?\s*)?PART\s*2:\s*FOR\s*MY\s*COOK[^\n]*/i;
  
  const match1 = md.match(part1Regex);
  const match2 = md.match(part2Regex);
  const summaryRegex = /(?:###?\s*)?Daily\s*Sodium\s*&\s*Potassium\s*Summary/i;
  const matchSummary = md.match(summaryRegex);
  
  let startIndex = 0;
  if (match1 && match1.index !== undefined) {
    startIndex = match1.index + match1[0].length;
  }
  
  if (matchSummary && matchSummary.index !== undefined) {
    if (!match1 || matchSummary.index < match1.index) {
      startIndex = matchSummary.index;
    }
  }
  
  let endIndex = md.length;
  if (match2 && match2.index !== undefined) {
    endIndex = match2.index;
  }
  
  let part1 = md.substring(startIndex, endIndex).trim();
  
  // Clean up leading/trailing markdown dividers if any
  if (part1.endsWith('---')) {
    part1 = part1.substring(0, part1.length - 3).trim();
  }
  if (part1.startsWith('---')) {
    part1 = part1.substring(3).trim();
  }
  
  return part1;
}

// Helper: Format Markdown content specifically for WhatsApp (convert tables to lists, etc.)
function formatMarkdownForWhatsApp(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const resultLines = [];
  let currentTable = [];

  const flushTable = () => {
    if (currentTable.length === 0) return;
    
    // Process the table rows
    // Filter out header separators
    const dataRows = currentTable.filter(row => {
      const cells = row.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length > 0 && cells.every(c => /^[-:]+$/.test(c))) {
        return false;
      }
      return true;
    });

    if (dataRows.length > 0) {
      const firstRowCells = dataRows[0].split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      const isHeader = firstRowCells.some(c => /ingredient|weight|calorie/i.test(c));
      
      const startIdx = isHeader ? 1 : 0;
      
      for (let i = startIdx; i < dataRows.length; i++) {
        const cells = dataRows[i].split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cells.length === 0) continue;
        const firstCell = cells[0].toLowerCase();
        if (firstCell.includes('total') || firstCell.includes('sum')) {
          const parts = [];
          if (cells[3]) {
            let calVal = cells[3];
            if (calVal && !/kcal/i.test(calVal) && !isNaN(calVal.replace(/[^\d.]/g, ''))) {
              calVal = `${calVal} kcal`;
            }
            parts.push(`Calories: ${calVal}`);
          }
          if (cells[4]) parts.push(`P: ${cells[4]}`);
          if (cells[5]) parts.push(`C: ${cells[5]}`);
          if (cells[6]) parts.push(`F: ${cells[6]}`);
          
          if (parts.length > 0) {
            resultLines.push(`*${cells[0]}: ${parts.join(' | ')}*`);
          } else {
            let val = '';
            for (let j = cells.length - 1; j >= 0; j--) {
              if (cells[j]) {
                val = cells[j];
                break;
              }
            }
            if (val && !/kcal/i.test(val) && !isNaN(val.replace(/[^\d.]/g, ''))) {
              val = `${val} kcal`;
            }
            resultLines.push(`*${cells[0]}: ${val}*`);
          }
        } else {
          if (cells.length >= 4) {
            let calVal = cells[3];
            if (calVal && !/kcal/i.test(calVal) && !isNaN(calVal.replace(/[^\d.]/g, ''))) {
              calVal = `${calVal} kcal`;
            }
            let macroInfo = '';
            if (cells.length >= 7) {
              const p = cells[4];
              const c = cells[5];
              const f = cells[6];
              if (p || c || f) {
                macroInfo = ` (P: ${p}, C: ${c}, F: ${f})`;
              }
            }
            resultLines.push(`• *${cells[0]}*: ${cells[1]} (Daily: ${cells[2]}) — _${calVal}_${macroInfo}`);
          } else if (cells.length === 3) {
            let calVal = cells[2];
            if (calVal && !/kcal/i.test(calVal) && !isNaN(calVal.replace(/[^\d.]/g, ''))) {
              calVal = `${calVal} kcal`;
            }
            resultLines.push(`• *${cells[0]}*: ${cells[1]} — _${calVal}_`);
          } else if (cells.length === 2) {
            resultLines.push(`• *${cells[0]}*: ${cells[1]}`);
          } else {
            resultLines.push(`• *${cells[0]}*`);
          }
        }
      }
    }
    
    currentTable = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1) {
      currentTable.push(trimmed);
    } else {
      if (currentTable.length > 0) {
        flushTable();
      }
      
      let processed = line;
      processed = processed.replace(/^\s*(#+)\s*(.*)$/g, '*$2*');
      processed = processed.replace(/^(\s*)[-*+]\s+/g, '$1• ');
      processed = processed.replace(/\*\*/g, '*');
      
      resultLines.push(processed);
    }
  }

  if (currentTable.length > 0) {
    flushTable();
  }

  return resultLines.join('\n');
}

// Helper: Extract Part 2 (Cook Instructions) from response markdown
function extractCookInstructions(md, dayName) {
  if (!md) return `No plan generated for ${dayName}.`;

  const splitRegex = /(?:###?\s*)?PART\s*2:\s*FOR\s*MY\s*COOK[^\n]*/i;
  const match = md.match(splitRegex);
  
  let part2 = '';
  if (match && match.index !== undefined) {
    part2 = md.substring(match.index + match[0].length).trim();
    if (part2.startsWith('---')) {
      part2 = part2.substring(3).trim();
    }
  } else {
    // Fallback: split by last horizontal rule
    const sections = md.split('---');
    if (sections.length > 1) {
      part2 = sections[sections.length - 1].trim();
    } else {
      part2 = md.trim();
    }
  }

  return part2;
}

// -------------------------------------------------------------
// HTTP HEALTH CHECK SERVER FOR HUGGING FACE SPACES
// -------------------------------------------------------------
const http = require('http');
const net = require('net');

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const start = Date.now();
    socket.setTimeout(4000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve({ success: true, timeMs: Date.now() - start });
    });
    
    socket.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, error: 'timeout' });
    });
    
    socket.connect(port, host);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = req.url || '';
  if (parsedUrl.startsWith('/diag')) {
    try {
      const googleDiag = await checkTcp('google.com', 443);
      const whatsappDiag = await checkTcp('web.whatsapp.com', 443);
      
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        google: googleDiag,
        whatsapp: whatsappDiag,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Diagnostic Error: ' + err.message);
    }
    return;
  }

  if (parsedUrl.startsWith('/logs')) {
    res.writeHead(200, { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(logsBuffer.join('\n'));
    return;
  }

  if (parsedUrl.startsWith('/reset')) {
    try {
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: true, message: 'Resetting WhatsApp worker...' }));
      
      // Perform reset and restart worker
      (async () => {
        console.log('Manual reset requested via HTTP api.');
        await resetWhatsAppSession();
        await WhatsAppState.findOneAndUpdate(
          {},
          { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
          { upsert: true }
        );
        if (client) {
          try {
            await client.destroy();
          } catch (e) {}
        }
        console.log('Exiting worker process after manual reset...');
        setTimeout(() => {
          process.exit(1);
        }, 1000);
      })();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Reset Error: ' + err.message);
    }
    return;
  }

  try {
    const stateDoc = await WhatsAppState.findOne();
    const schedulerDoc = await Scheduler.findOne();
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' // Allow Vercel frontend to query if needed
    });
    
    res.end(JSON.stringify({ 
      status: 'online', 
      worker: 'whatsapp-worker', 
      whatsapp: stateDoc ? stateDoc.status : 'unknown',
      scheduler: schedulerDoc ? { enabled: schedulerDoc.isEnabled, lastSent: schedulerDoc.lastSentDate } : 'unknown'
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error: ' + e.message);
  }
});

const PORT = process.env.PORT || 7860;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP Health check server is listening on port ${PORT}`);
});

// -------------------------------------------------------------
// GRACEFUL SHUTDOWN HANDLERS
// -------------------------------------------------------------
async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Gracefully shutting down WhatsApp client...`);

  // Step 1: Save the WhatsApp session to MongoDB BEFORE destroying the client.
  // This is critical — client.destroy() triggers the 'disconnected' event, and
  // we must have the session safely stored before that happens.
  try {
    if (typeof client !== 'undefined' && client) {
      if (isClientReady && client.authStrategy && typeof client.authStrategy.storeRemoteSession === 'function') {
        console.log('Saving final WhatsApp session to MongoDB before destroying client...');
        await client.authStrategy.storeRemoteSession();
        console.log('Final WhatsApp session saved successfully.');
      } else {
        console.log('WhatsApp client is not ready/authenticated. Skipping session save on shutdown.');
      }
    }
  } catch (err) {
    console.error('Failed to save WhatsApp session during shutdown:', err);
  }

  // Step 2: Destroy the client (this triggers 'disconnected', but isShuttingDown
  // prevents the handler from wiping the session we just saved).
  try {
    if (typeof client !== 'undefined' && client) {
      console.log('Closing WhatsApp browser connection to release file locks...');
      await client.destroy();
      console.log('WhatsApp client destroyed.');
    }
  } catch (err) {
    console.error('Error during graceful shutdown of WhatsApp client:', err);
  }

  // Step 3: Update DB state and close the MongoDB connection.
  try {
    if (mongoose.connection.readyState !== 0) {
      await WhatsAppState.findOneAndUpdate(
        {},
        { status: 'disconnected', qr: '' }
      );
    }
  } catch (err) {
    console.error('Failed to reset WhatsApp state in database during shutdown:', err);
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed.');
    }
  } catch (dbErr) {
    console.error('Error closing MongoDB connection:', dbErr);
  }

  process.exit(0);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// -------------------------------------------------------------
// CATCH UNHANDLED PROMISE REJECTIONS (e.g. RemoteAuth "auth timeout")
// -------------------------------------------------------------
process.on('unhandledRejection', (reason, promise) => {
  const reasonStr = typeof reason === 'string' ? reason : (reason && reason.message) || String(reason);
  console.error('Unhandled Promise Rejection caught:', reasonStr);

  if (reasonStr.includes('auth timeout')) {
    // This is a stale timeout from RemoteAuth internals that fires even after
    // the client has already authenticated and reached the "ready" state.
    // It is safe to ignore — the session is valid and working.
    console.warn('RemoteAuth "auth timeout" detected — this is a known spurious error. Client is already authenticated. Ignoring.');
  } else {
    console.error('Unhandled rejection (non-auth):', reason);
  }
});
