import { NextResponse } from 'next/server';
import { dbConnect, WhatsAppState, Config } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';
import mongoose from 'mongoose';

export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    // 1. Try to fetch configuration to get Hugging Face Space info
    const config = await Config.findOne();
    if (config && config.huggingFaceSpace) {
      try {
        const normalized = config.huggingFaceSpace.replace(/[\/_.]/g, '-').toLowerCase();
        const spaceUrl = `https://${normalized}.hf.space/reset`;

        console.log(`Sending reset request to worker space: ${spaceUrl}`);

        const headers: Record<string, string> = {};
        if (config.huggingFaceToken) {
          headers['Authorization'] = `Bearer ${config.huggingFaceToken}`;
        }

        // Send a request to the worker's reset endpoint with a 4-second timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(spaceUrl, {
          method: 'GET', // Using GET as endpoint matched parsedUrl
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        console.log(`Worker reset API response status: ${res.status}`);
      } catch (err) {
        // If the worker is sleeping or offline, we log the error but still proceed
        // to reset the database session documents so it can start fresh when woke up.
        console.error('Failed to notify worker of reset, proceeding to clear DB:', err);
      }
    }

    // 2. Clear MongoDB GridFS session storage
    const db = mongoose.connection.db;
    if (db) {
      // Clear legacy whatsapp-session
      try {
        const bucket = new mongoose.mongo.GridFSBucket(db, {
          bucketName: 'whatsapp-session'
        });
        const documents = await bucket.find({ filename: 'session.zip' }).toArray();
        for (const doc of documents) {
          await bucket.delete(doc._id);
        }
        console.log('Successfully cleared GridFS session storage (session.zip).');
      } catch (err) {
        console.error('Failed to delete GridFS files for session:', err);
      }

      // Clear active whatsapp-RemoteAuth
      try {
        const bucket = new mongoose.mongo.GridFSBucket(db, {
          bucketName: 'whatsapp-RemoteAuth'
        });
        const documents = await bucket.find({ filename: 'RemoteAuth.zip' }).toArray();
        for (const doc of documents) {
          await bucket.delete(doc._id);
        }
        console.log('Successfully cleared GridFS session storage (RemoteAuth.zip).');
      } catch (err) {
        console.error('Failed to delete GridFS files for RemoteAuth:', err);
      }

      // Also clean up files/chunks manually just in case
      try {
        await db.collection('whatsapp-session.files').deleteMany({});
        await db.collection('whatsapp-session.chunks').deleteMany({});
        await db.collection('whatsapp-RemoteAuth.files').deleteMany({});
        await db.collection('whatsapp-RemoteAuth.chunks').deleteMany({});
      } catch {
        // Collections might not exist or already be dropped, ignore
      }
    }

    // 3. Reset the WhatsAppState in DB back to disconnected
    await WhatsAppState.findOneAndUpdate(
      {},
      {
        $set: {
          status: 'disconnected',
          qr: '',
          connectedPhone: '',
          connectedName: ''
        }
      },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      message: 'WhatsApp session reset successfully. Worker will restart and generate a new QR code.'
    });
  } catch (error) {
    console.error('Error resetting WhatsApp session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
