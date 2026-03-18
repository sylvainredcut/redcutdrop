const axios = require('axios');

async function sendDiscordNotification({ filename, client, week, filesize, link, comment, mode }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const sizeMB = filesize ? (filesize / 1048576).toFixed(1) + ' Mo' : 'N/A';

  let embed;

  if (mode === 'publish') {
    // Mise en ligne — notification d'archivage
    embed = {
      title: comment || 'Video archivee — prete pour publication',
      color: 0x16a34a, // vert
      fields: [
        { name: 'Fichier', value: filename, inline: false },
        { name: 'Marque', value: client, inline: true },
        { name: 'Semaine', value: week, inline: true },
        { name: 'Taille', value: sizeMB, inline: true }
      ],
      footer: { text: 'Mise en ligne — workflow N8N declenche' },
      timestamp: new Date().toISOString()
    };

    if (link) {
      embed.fields.push({ name: 'Archivage', value: `[Voir sur Frame.io](${link})`, inline: false });
    }
  } else {
    // Revision — notification classique
    embed = {
      title: comment || 'Nouvel upload sur Frame.io',
      color: 0xe63946, // rouge
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
      embed.fields.push({ name: 'Lien', value: `[Voir et commenter sur Frame.io](${link})`, inline: false });
    }
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
