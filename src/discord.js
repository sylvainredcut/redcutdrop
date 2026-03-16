const axios = require('axios');

async function sendDiscordNotification({ filename, client, week, filesize, link }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const sizeMB = filesize ? (filesize / 1048576).toFixed(1) + ' Mo' : 'N/A';

  const embed = {
    title: 'Nouvel upload sur Frame.io',
    color: 0xe63946,
    fields: [
      { name: 'Fichier', value: filename, inline: false },
      { name: 'Client', value: client, inline: true },
      { name: 'Semaine', value: week, inline: true },
      { name: 'Taille', value: sizeMB, inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  if (link) {
    embed.url = link;
    embed.fields.push({ name: 'Lien', value: `[Voir sur Frame.io](${link})`, inline: false });
  }

  try {
    await axios.post(webhookUrl, {
      username: 'Upload Redcut',
      embeds: [embed]
    });
  } catch (err) {
    console.error('Discord webhook error:', err.message);
  }
}

module.exports = { sendDiscordNotification };
