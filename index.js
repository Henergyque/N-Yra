require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// --- Slash Commands ---
const commands = [
  new SlashCommandBuilder()
    .setName('pfc')
    .setDescription('Jouer à Pierre Feuille Ciseaux contre le bot !')
    .toJSON(),
];

// --- Enregistrement des commandes au démarrage ---
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes slash enregistrées.');
  } catch (err) {
    console.error('❌ Erreur enregistrement commandes :', err);
  }
});

// --- Choix possibles ---
const choices = ['🪨 Pierre', '📄 Feuille', '✂️ Ciseaux'];

function getResult(playerIndex, botIndex) {
  if (playerIndex === botIndex) return '🤝 Égalité !';
  if (
    (playerIndex === 0 && botIndex === 2) || // Pierre bat Ciseaux
    (playerIndex === 1 && botIndex === 0) || // Feuille bat Pierre
    (playerIndex === 2 && botIndex === 1)    // Ciseaux bat Feuille
  ) {
    return '🎉 Tu as gagné !';
  }
  return '😈 Tu as perdu !';
}

// --- Interaction handler ---
client.on('interactionCreate', async (interaction) => {
  // Slash command /pfc
  if (interaction.isChatInputCommand() && interaction.commandName === 'pfc') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pfc_0').setLabel('🪨 Pierre').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('pfc_1').setLabel('📄 Feuille').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('pfc_2').setLabel('✂️ Ciseaux').setStyle(ButtonStyle.Danger),
    );

    const embed = new EmbedBuilder()
      .setTitle('Pierre Feuille Ciseaux')
      .setDescription('Fais ton choix !')
      .setColor(0x5865f2);

    await interaction.reply({ embeds: [embed], components: [row] });
    return;
  }

  // Bouton cliqué
  if (interaction.isButton() && interaction.customId.startsWith('pfc_')) {
    const playerIndex = parseInt(interaction.customId.split('_')[1], 10);
    const botIndex = Math.floor(Math.random() * 3);

    const result = getResult(playerIndex, botIndex);

    const embed = new EmbedBuilder()
      .setTitle('Pierre Feuille Ciseaux — Résultat')
      .addFields(
        { name: 'Ton choix', value: choices[playerIndex], inline: true },
        { name: 'Mon choix', value: choices[botIndex], inline: true },
      )
      .setDescription(result)
      .setColor(result.includes('gagné') ? 0x57f287 : result.includes('perdu') ? 0xed4245 : 0xfee75c);

    await interaction.update({ embeds: [embed], components: [] });
  }
});

client.login(process.env.TOKEN);
