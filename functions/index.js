const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

async function sendPush(memberId, deviceTokens, payload) {
  const response = await admin.messaging().sendToDevice(deviceTokens, payload);
  const tokensToRemove = [];

  // check if an error occurred.
  response.results.forEach((result, index) => {
    const error = result.error;
    if (error) {
      console.error(
        `Failure sending notification to" ${deviceTokens[index]} ${error}`
      );
      // delete invalid tokens
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        const deviceTokenRef = db
          .collection("members")
          .doc(memberId)
          .collection("deviceTokens")
          .doc(deviceTokens[index]);
        tokensToRemove.push(deviceTokenRef.delete());
      }
    } else {
      console.log(`push sent to ${deviceTokens[index]}`);
    }
  });
  return Promise.all(tokensToRemove);
}

// send push notification for each new message in a channel to all the other channel members using FCM
exports.listenOnNewMessageFcm = functions.firestore
  .document("channelMessages/{channelId}/message/{messageId}")
  .onCreate(async (snap, ctx) => {
    // get message details
    const messageDetails = snap.data();
    // get channel id
    const { channelId } = ctx.params;

    // get channel reference
    const channelRef = db.collection("channels").doc(channel_id);
    // get channel members reference
    const channelMembersRef = db
      .collection("channelMembers")
      .doc(channelId)
      .collection("members");

    // get channel and channel members details
    const results = await Promise.all([
      channelRef.get(),
      channelMembersRef.get()
    ]);
    const channelDetails = results[0].data();
    const channelMembersDetails = results[1];

    // construct payload for push notification
    const payload = {
      notification: {
        title: channelDetails.name,
        body: `${messageDetails.sender.name}: ${messageDetails.message}`,
        sound: "default"
      },
      data: {
        notification_id: channelId,
        channelId: channelDetails.id,
        channelType: channelDetails.type
      }
    };

    // get channel members id list
    const channelMembersId = [];
    channelMembersDetails.forEach(doc => {
      channelMembersId.push(doc.id);
    });

    return await Promise.all(
      channelMembersId.map(async memberId => {
        // do not send push notification to message sender
        if (memberId !== messageDetails.sender.id) {
          const memberDeviceTokens = await db
            .collection("members")
            .doc(memberId)
            .collection("deviceTokens")
            .get();

          // get all device tokens of member
          const deviceTokens = [];
          memberDeviceTokens.forEach(doc => {
            deviceTokens.push(doc.id);
          });

          if (deviceTokens.length !== 0) {
            return sendPush(memberId, deviceTokens, payload);
          }
        }
      })
    );
  });
