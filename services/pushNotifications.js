const admin = require('firebase-admin');
const User = require('../models/User');

let initialized = false;

function initFirebase() {
  if (initialized) return true;
  
  // MANUAL STEP REQUIRED: client must provide the Firebase service account JSON key and set it as an environment variable or secure file on the server (e.g. FIREBASE_SERVICE_ACCOUNT_KEY in .env)
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    console.warn('[FCM Push Service] Warning: FIREBASE_SERVICE_ACCOUNT_KEY is not defined in environment variables. Push notifications will be logged to console instead of sending to real devices.');
    return false;
  }

  try {
    const serviceAccount = typeof serviceAccountKey === 'string' && serviceAccountKey.startsWith('{')
      ? JSON.parse(serviceAccountKey)
      : require(serviceAccountKey); // fallback if it's a file path
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    initialized = true;
    console.log('✅ [FCM Push Service] Firebase Admin initialized successfully');
    return true;
  } catch (err) {
    console.error('❌ [FCM Push Service] Failed to initialize Firebase Admin SDK:', err.message);
    return false;
  }
}

async function sendPushNotification(userId, title, body, data = {}) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      console.warn(`[FCM Push Service] User ${userId} not found`);
      return;
    }

    const token = user.fcmToken;
    if (!token) {
      console.log(`[FCM Push Service] User ${user.name} (${userId}) has no registered FCM token. Notification logged: "${title}: ${body}"`);
      return;
    }

    // Convert all values in the data object to strings to prevent Firebase payload errors
    const stringifiedData = {};
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
          stringifiedData[key] = String(value);
        }
      }
    }

    console.log(`[FCM Push Service] Preparing to send push notification to ${user.name} (${token}): "${title}: ${body}"`);

    const hasFirebase = initFirebase();
    if (!hasFirebase) {
      console.log(`[FCM Push Service] [MOCK SEND] Token: ${token} | Title: ${title} | Body: ${body} | Data:`, stringifiedData);
      return;
    }

    const message = {
      token: token,
      notification: {
        title: title,
        body: body,
      },
      data: stringifiedData,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          defaultSound: true,
          channelId: 'opsfly_notifications_high'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          }
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ [FCM Push Service] Push notification sent successfully, response:`, response);
    return response;
  } catch (error) {
    console.error(`❌ [FCM Push Service] Failed to send push notification to user ${userId}:`, error.message);
  }
}

module.exports = { sendPushNotification };
