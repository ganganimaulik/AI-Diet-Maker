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

// -------------------------------------------------------------
// INITIALIZE DATABASE & WORKER
// -------------------------------------------------------------
let client;
let store;
let isClientReady = false;
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
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    if (process.platform === 'linux') {
      executablePath = '/usr/bin/chromium';
    } else if (process.platform === 'darwin') {
      const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      if (fs.existsSync(macChromePath)) {
        executablePath = macChromePath;
      }
    }
  }
  
  console.log(`Initializing WhatsApp Client (Chrome Path: ${executablePath || 'default'})...`);

  // Build puppeteer args dynamically based on platform
  const puppeteerArgs = [
    '--no-sandbox', 
    '--disable-setuid-sandbox', 
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
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
      store: store,
      backupSyncIntervalMs: 120000 // Backup session to DB every 2 mins
    }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
      strict: false
    },
    puppeteer: {
      executablePath: executablePath,
      headless: true,
      args: puppeteerArgs,
      protocolTimeout: 180000, // Wait up to 3 mins for Puppeteer protocol calls
      timeout: 180000, // Page navigation timeout: 3 mins (default 30s is too short for HF Spaces)
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
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
    await resetWhatsAppSession();
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
      { upsert: true }
    );
    console.log('Exiting worker process to restart and generate new QR code...');
    setTimeout(() => {
      process.exit(1);
    }, 2000);
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
  try {
    console.log('Fetching WhatsApp chats to cache contacts...');
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
  } catch (err) {
    console.error('Failed to sync contacts:', err);
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
    const prompt = compilePromptTextForDay(configDoc, targetDayName);

    // 4. Call Gemini API
    console.log('Generating diet plan from Gemini...');
    const generatedText = await callGeminiAPI(configDoc, prompt);
    
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

// Helper: Compile single-day prompt
function compilePromptTextForDay(c, dayName) {
  const idealMin = c.global.idealSodiumPotassiumRatioMin === undefined ? 0.70 : c.global.idealSodiumPotassiumRatioMin;
  const idealMax = c.global.idealSodiumPotassiumRatioMax === undefined ? 0.80 : c.global.idealSodiumPotassiumRatioMax;
  const idealMinStr = idealMin.toFixed(2);
  const idealMaxStr = idealMax.toFixed(2);
  const mealsList = c.meals || [];
  let splitsList = c.customSplits || [];
  
  if (splitsList.length === 0) {
    if (c.splits) {
      splitsList = [
        { id: 'salt', name: 'Salt Seasoning Split', value: c.splits.saltSplit || '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: c.splits.chickenPrepMethod || 'Chicken air fryer 200c, 15 min' }
      ];
    } else {
      splitsList = [
        { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min' }
      ];
    }
  }
  
  // Load overridden splits for today (with fallback to global defaults)
  const dailySplitsMap = c.dailySplits || {};
  let todaySplits = [];
  if (typeof dailySplitsMap.get === 'function') {
    todaySplits = dailySplitsMap.get(dayName) || [];
  } else {
    todaySplits = dailySplitsMap[dayName] || [];
  }

  splitsList = splitsList.map(globalSplit => {
    const override = todaySplits.find(o => o.id === globalSplit.id);
    return {
      id: globalSplit.id,
      name: globalSplit.name,
      value: override ? override.value : globalSplit.value
    };
  });

  // Load variables for today
  // Since dailyVariables is a Map in Mongoose schema, we fetch keys
  const dailyVariablesMap = c.dailyVariables || {};
  let todayIngredients = [];
  if (typeof dailyVariablesMap.get === 'function') {
    todayIngredients = dailyVariablesMap.get(dayName) || [];
  } else {
    todayIngredients = dailyVariablesMap[dayName] || [];
  }

  // Filter out disabled ingredients
  todayIngredients = todayIngredients.filter(ing => !ing.disabled);
  
  const dynamicIngredientSplits = [];
  mealsList.forEach(meal => {
    (meal.ingredients || []).forEach(ing => {
      if (ing.split && ing.split.trim()) {
        dynamicIngredientSplits.push(`${meal.name} Ingredient Split: ${ing.name} total daily split instruction is "${ing.split.trim()}"`);
      }
    });
  });

  const dayVars = todayIngredients;
  dayVars.forEach(ing => {
    if (!ing.disabled && ing.split && ing.split.trim()) {
      dynamicIngredientSplits.push(`Daily Variable Split: ${ing.name} split instruction is "${ing.split.trim()}"`);
    }
  });

  const allSplits = [
    ...dynamicIngredientSplits,
    ...splitsList.map(s => `${s.name}: ${s.value}`)
  ];

  const splitsText = allSplits.map(s => `- ${s}`).join('\n');

  const mealsTargetText = mealsList
    .map((meal, idx) => `- Meal ${idx + 1} (${meal.name}): eaten ${meal.mealsPerDay} times per day`)
    .join('\n');

  const mealsDetailsText = mealsList
    .map((meal, idx) => `
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (FOR 1 MEAL)]
${meal.ingredients.map(ing => `- ${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}${ing.split ? ` (split instruction: ${ing.split})` : ''}`).join('\n')}
${meal.water ? `- liquids: ${meal.water}` : ''}
${meal.prepMethod ? `- prep method: ${meal.prepMethod.split('\n').map((line, i) => i === 0 ? line : `  ${line}`).join('\n')}` : ''}
`).join('\n');

  const getDayVariantName = (ingredients) => {
    const nonStapleNames = ingredients
      .filter(ing => !ing.disabled && !ing.personalOnly)
      .map(ing => ing.name);
    if (nonStapleNames.length === 0) return 'Staples Only';
    if (nonStapleNames.length === 1) return `Just ${nonStapleNames[0]}`;
    return nonStapleNames.join(' + ');
  };

  const variant = getDayVariantName(todayIngredients);
  const itemsText = todayIngredients.map(ing => `${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}${ing.split ? ` (split instruction: ${ing.split})` : ''}${ing.personalOnly ? ' [PERSONAL ONLY - DO NOT SEND TO COOK]' : ''}`).join(', ');
  const dailyVariablesText = `- ${dayName} (${variant}): ${itemsText}`;

  return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions. 

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories). 
- PART 2 must be a raw, copy-pasteable weekly text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS, WEIGHTS & SPLITS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
${mealsTargetText}

${mealsDetailsText}
[COOK COOKING & SEASONING SPLITS / INSTRUCTIONS]
${splitsText}

[DAILY VARIABLE INGREDIENT WEIGHTS (WHOLE DAY)]
* Note: Use [AUTO] for any ingredient you want the calculator to dynamically scale to hit your exact Daily Calorie Target.
${dailyVariablesText}

===================================================================
                        MATH & OUTPUT GENERATION
===================================================================

INSTRUCTIONS FOR THE CALCULATOR:
1. Estimate the raw/uncooked calorie density (kcal per 1g) for each ingredient using standard USDA nutritional values (e.g. Raw Rice ≈ 3.6 kcal/g, Raw Chicken Breast ≈ 1.2 kcal/g, Olive Oil ≈ 8.75 kcal/g, Eggs ≈ 1.43 kcal/g, Butter ≈ 7.17 kcal/g, Pasta ≈ 3.55 kcal/g, Raw Oats ≈ 3.89 kcal/g, Whey Protein Isolate ≈ 3.7 kcal/g, Almonds ≈ 5.79 kcal/g, Cashews ≈ 5.53 kcal/g, Walnuts ≈ 6.54 kcal/g, Banana ≈ 0.89 kcal/g, Tomato ≈ 0.18 kcal/g, Potato (Raw) ≈ 0.77 kcal/g, Cluster Beans ≈ 0.16 kcal/g, Bottle Gourd ≈ 0.15 kcal/g, Brinjal ≈ 0.25 kcal/g, etc.).
2. For the selected day (${dayName}), sum the calculated calories of all strictly defined weights across all meals and daily variables:
   - Daily calories from meals = Sum over all meals of: (sum of calories of all ingredients in that meal) x (meals per day for that meal)
   - Daily variables calories = sum of calories of all variables for that day
3. Subtract that total (meals + variables) from the [Daily Calorie Target] to find the remaining calorie deficit.
4. Convert that remaining calorie deficit into grams for the ingredient(s) marked \`[AUTO]\` using their calorie density to determine their exact weight. 
5. If a day contains multiple \`[AUTO]\` ingredients:
   - If there are 2 or more \`[AUTO]\` ingredients, dynamically adjust the calorie split (e.g. 60-40, 70-30, 80-20, etc.) among them to steer the resulting daily Sodium-to-Potassium Ratio (Na:K Ratio) into the ideal range of ${idealMinStr} to ${idealMaxStr}.
   - Leverage the differing natural sodium and potassium densities of the \`[AUTO]\` ingredients. For example, if the ratio is above ${idealMaxStr}, allocate more calories to high-potassium ingredients (like Potato) and fewer to low-potassium ones (like Rice) to lower the ratio. Conversely, if the ratio is below ${idealMinStr}, allocate more to low-potassium/high-calorie density ingredients to raise the ratio.
   - If the ratio is already in the ideal range of ${idealMinStr} to ${idealMaxStr} with a 50-50 split, or if it is mathematically impossible to reach the ideal range by adjusting the split (or if the ingredients have very similar nutritional profiles), default to distributing the remaining calorie deficit equally.
   - Ensure all resulting weights are non-negative, and that their combined calories sum exactly to the remaining calorie deficit.
   - Perform any calorie split or math calculations privately in your thinking process. Do NOT include any step-by-step math, solved weights strategies, or calculation details in the final output text of Part 1 or Part 2.
6. For each meal, divide its daily baseline weights and any daily variable weights by the meal's daily frequency to find the per-meal weight.
7. Round all final calculated weights and calories to the nearest whole number so that the day's total hits your target exactly.
8. Calculate the total daily Sodium (Na) and Potassium (K) in milligrams (mg), and their ratio (Na:K ratio) for the day:
   - Table salt (NaCl) contains approximately 388 mg of sodium per 1 g of salt.
   - Look at the "Salt Seasoning Split" split value config under cooking splits. Identify the portion that is boiled with water where chicken is boiled and then the water is thrown away (e.g., "7g in chicken with 1 liter water"). For this portion, assume that only 10% of the salt/sodium is absorbed and retained by the chicken (meaning only 0.7g of salt is consumed, while the other 90% is discarded with the water). All other salt split allocations (e.g. in subji, in marinate paste) are assumed to be 100% consumed.
   - Estimate natural sodium per 100g of raw ingredients: Raw Chicken Breast ≈ 70mg, White Rice ≈ 5mg, Potato (Raw) ≈ 6mg, Tomato ≈ 5mg, Bottle Gourd ≈ 2mg, Cluster Beans ≈ 2mg, Brinjal ≈ 2mg, Olive Oil ≈ 2mg, Eggs ≈ 140mg, Oats ≈ 2mg, Whey Protein ≈ 160mg, Nuts ≈ 1mg, Banana ≈ 1mg.
   - Estimate natural potassium per 100g of raw ingredients: Raw Chicken Breast ≈ 256mg, White Rice ≈ 115mg, Potato (Raw) ≈ 400mg, Tomato ≈ 237mg, Bottle Gourd ≈ 150mg, Cluster Beans ≈ 230mg, Brinjal ≈ 230mg, Olive Oil ≈ 1mg, Eggs ≈ 130mg, Oats ≈ 429mg, Whey Protein ≈ 350mg, Almonds/Cashews/Walnuts ≈ 600mg, Banana ≈ 358mg.
   - Compute Total Daily Sodium (mg) = Sodium from consumed salt + Natural sodium from all daily ingredients.
   - Compute Total Daily Potassium (mg) = Natural potassium from all daily ingredients.
   - Compute the Sodium-to-Potassium Ratio (Na:K Ratio) = Total Daily Sodium (mg) / Total Daily Potassium (mg) (rounded to 2 decimal places).
   - Evaluate the Na:K Ratio against the ideal range of ${idealMinStr} to ${idealMaxStr}:
     - If the ratio is below ${idealMinStr}, calculate the additional Sodium required to reach a ratio of ${idealMinStr}: Additional Na (mg) = (${idealMinStr} * Total Daily Potassium) - Total Daily Sodium. Also convert this to equivalent additional salt grams: Additional Salt (g) = Additional Na (mg) / 388 (rounded to 2 decimal places).
     - If the ratio is above ${idealMaxStr}, calculate the additional Potassium required to reach a ratio of ${idealMaxStr}: Additional Potassium to ${idealMaxStr} (mg) = (Total Daily Sodium / ${idealMaxStr}) - Total Daily Potassium (rounded to the nearest whole number). Also calculate the additional Potassium required to reach a ratio of ${idealMinStr}: Additional Potassium to ${idealMinStr} (mg) = (Total Daily Sodium / ${idealMinStr}) - Total Daily Potassium (rounded to the nearest whole number).
     - If the ratio is between ${idealMinStr} and ${idealMaxStr} (inclusive), the ratio is ideal.
9. Calculate the total daily Protein (g), Carbohydrates (g), and Fat (g) by estimating the macronutrient densities of all daily ingredients (including solved [AUTO] weights and variables) using standard USDA nutritional values. Convert these macronutrient grams to calories (assuming Protein = 4 kcal/g, Carbohydrates = 4 kcal/g, Fat = 9 kcal/g) and sum their calories up to verify it matches the total daily calories target.
10. If any ingredient has a split instruction (e.g. '50% in subji, remaining in chicken' or '3g in subji, remaining in marinate'), you MUST calculate the exact weights in grams for each split part (based on the total daily resolved weight of that ingredient, resolving any percentages or math allocations) and display the resulting splits clearly in the final splits section of Part 1 and Part 2. Ensure the sum of split weights matches the total ingredient weight exactly.

---

PART 1: FOR MYSELF (User Breakdown)
Generate this exact section first using markdown tables and bullet points based strictly on your calculations.

At the very top of Part 1 (above any meal breakdowns/tables), you MUST print a bolded summary block for the daily sodium and potassium levels. Format it exactly as follows:
### Daily Sodium & Potassium Summary
For the day (${dayName}):
- **${dayName}**: Total Sodium: **[X] mg** | Total Potassium: **[Y] mg** | Na:K Ratio: **[Z]** ([Ideal / Below Ideal / Above Ideal])
  * (Include a brief breakdown note showing how you calculated this: e.g., "Includes [X_salt]mg sodium from consumed salt and [X_natural]mg natural sodium. Consumed salt includes 100% of [non-water-boiled splits] and only 10% of [water-boiled splits] (water discarded). Total potassium is from natural ingredients.")
  * **Ratio Adjustment Info**: [If ideal: "Ratio is in the ideal range (${idealMinStr} - ${idealMaxStr})." If below ${idealMinStr}: "Ratio is below ideal. Need an additional [A] mg of Sodium (approx. [B] g of table salt) to reach ${idealMinStr}." If above ${idealMaxStr}: "Ratio is above ideal. Need an additional [C] mg of Potassium to reach ${idealMaxStr} (or [D] mg to reach ${idealMinStr})."]

${mealsList.map((meal, idx) => `
${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)
Include a markdown table with columns: Ingredient, Weight Per Meal, Daily Total (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''}), Calories (Per Meal), Protein (Per Meal), Carbs (Per Meal), Fat (Per Meal). For Protein, Carbs, and Fat, estimate their values from the raw ingredient weights using standard USDA values and print them as "Xg (Y kcal)". At the bottom of the table, include a "Total" row summing the total calculated calories, protein, carbs, and fat for the meal (e.g. Total calories, and macro sums formatted as "Total_grams g (Total_kcal kcal)").
`).join('\n')}

Include a Daily Totals (Summary) bulleted section at the bottom of Part 1 aggregating the calculated daily sum total across all meals to prove it hits your configured target. You MUST also show the total daily macros (Protein in grams & calories, Carbs in grams & calories, Fat in grams & calories) and the final aggregated Total Daily Calories.

---

PART 2: FOR MY COOK (Weekly Text Plan)
Separate this from Part 1 using a horizontal rule (---). Output only the day ${dayName} using the exact line-by-line template below. Map your calculated total daily weights (including solved \`[AUTO]\` weights) and cooking splits/instructions directly. Absolutely no conversational text, tables, or calorie mentions in this section.

CRITICAL: You MUST exclude any daily variable ingredients marked with [PERSONAL ONLY - DO NOT SEND TO COOK] from PART 2 entirely. They must not appear under any day's ingredient list, meal preparation, splits, or variant names in PART 2.

CRITICAL: Under PART 2 (FOR MY COOK), you MUST completely exclude any ingredient that has a split instruction (e.g. Olive oil, or any other ingredient with split details) and its total weight from the meal ingredient lists (do not print their names or total weights under any meal name in Part 2). This is to prevent the cook from adding them multiple times. Instead, the cook should only see their split details in the splits/cooking instructions section.

Exact Output Template to Follow:

### ${dayName}: ${variant}
[For each meal, list its ingredients with daily total weights in grams. Then, if and only if a liquid configuration is explicitly defined in that meal's weights configuration section, list it. Do not infer or invent liquids from other sections like seasoning/salt splits. List prep methods without any hyphen or bullet point prefix. E.g.
"Meal Name:
ingredient1 name 150g
ingredient2 name 100g
liquids: 190g water
prep method: airfryer 200c, 10min"]
[List all custom splits and cooking instructions for each day here, again with no hyphen prefix]
`;
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
let isShuttingDown = false;

async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Gracefully shutting down WhatsApp client...`);
  
  try {
    if (mongoose.connection.readyState !== 0) {
      // Reset status in database to disconnected on graceful shutdown
      await WhatsAppState.findOneAndUpdate(
        {},
        { status: 'disconnected', qr: '' }
      );
    }
  } catch (err) {
    console.error('Failed to reset WhatsApp state in database during shutdown:', err);
  }

  try {
    if (typeof client !== 'undefined' && client && isClientReady) {
      if (client.authStrategy && typeof client.authStrategy.storeRemoteSession === 'function') {
        console.log('Saving final WhatsApp session to MongoDB before destroying client...');
        await client.authStrategy.storeRemoteSession();
        console.log('Final WhatsApp session saved successfully.');
      }
    } else {
      console.log('WhatsApp client is not ready/authenticated. Skipping session save on shutdown.');
    }
      
      console.log('Closing WhatsApp browser connection to release file locks...');
      await client.destroy();
      console.log('WhatsApp client destroyed.');
    }
  } catch (err) {
    console.error('Error during graceful shutdown of WhatsApp client:', err);
  } finally {
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
