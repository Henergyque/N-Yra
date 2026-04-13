require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// --- Slash Commands ---
const commands = [
  new SlashCommandBuilder()
    .setName('pfc')
    .setDescription('Jouer à Pierre Feuille Ciseaux !')
    .addUserOption(option =>
      option.setName('adversaire')
        .setDescription('Mentionne un joueur pour jouer contre lui (sinon contre le bot)')
        .setRequired(false))
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

// --- Duels en cours (joueur vs joueur) ---
const duels = new Map();

function getResult(p1Index, p2Index) {
  if (p1Index === p2Index) return 'égalité';
  if (
    (p1Index === 0 && p2Index === 2) ||
    (p1Index === 1 && p2Index === 0) ||
    (p1Index === 2 && p2Index === 1)
  ) {
    return 'p1';
  }
  return 'p2';
}

function buildButtons(prefix) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_0`).setLabel('🪨 Pierre').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${prefix}_1`).setLabel('📄 Feuille').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${prefix}_2`).setLabel('✂️ Ciseaux').setStyle(ButtonStyle.Danger),
  );
}

// --- Interaction handler ---
client.on('interactionCreate', async (interaction) => {
  // Slash command /pfc
  if (interaction.isChatInputCommand() && interaction.commandName === 'pfc') {
    const opponent = interaction.options.getUser('adversaire');

    // --- Mode 1v1 ---
    if (opponent) {
      if (opponent.id === interaction.user.id) {
        return interaction.reply({ content: '❌ Tu ne peux pas jouer contre toi-même !', ephemeral: true });
      }
      if (opponent.bot) {
        return interaction.reply({ content: '❌ Tu ne peux pas défier un bot ! Utilise `/pfc` sans adversaire.', ephemeral: true });
      }

      const duelId = interaction.id;
      duels.set(duelId, {
        challenger: interaction.user.id,
        opponent: opponent.id,
        choices: {},
      });

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Pierre Feuille Ciseaux — Duel !')
        .setDescription(`${interaction.user} défie ${opponent} !\nChacun doit cliquer sur un bouton ci-dessous.\n*Votre choix sera secret.*`)
        .setColor(0x5865f2);

      const row = buildButtons(`duel_${duelId}`);
      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    // --- Mode solo (contre le bot) ---
    const row = buildButtons('pfc');
    const embed = new EmbedBuilder()
      .setTitle('Pierre Feuille Ciseaux')
      .setDescription('Fais ton choix !')
      .setColor(0x5865f2);

    await interaction.reply({ embeds: [embed], components: [row] });
    return;
  }

  // --- Boutons ---
  if (!interaction.isButton()) return;

  // Solo contre le bot
  if (interaction.customId.startsWith('pfc_')) {
    const playerIndex = parseInt(interaction.customId.split('_')[1], 10);
    const botIndex = Math.floor(Math.random() * 3);
    const result = getResult(playerIndex, botIndex);

    let description, color;
    if (result === 'égalité') { description = '🤝 Égalité !'; color = 0xfee75c; }
    else if (result === 'p1') { description = '🎉 Tu as gagné !'; color = 0x57f287; }
    else { description = '😈 Tu as perdu !'; color = 0xed4245; }

    const embed = new EmbedBuilder()
      .setTitle('Pierre Feuille Ciseaux — Résultat')
      .addFields(
        { name: 'Ton choix', value: choices[playerIndex], inline: true },
        { name: 'Mon choix', value: choices[botIndex], inline: true },
      )
      .setDescription(description)
      .setColor(color);

    await interaction.update({ embeds: [embed], components: [] });
    return;
  }

  // Duel 1v1
  if (interaction.customId.startsWith('duel_')) {
    const parts = interaction.customId.split('_');
    const duelId = parts[1];
    const choiceIndex = parseInt(parts[2], 10);
    const duel = duels.get(duelId);

    if (!duel) {
      return interaction.reply({ content: '❌ Ce duel a expiré.', ephemeral: true });
    }

    const userId = interaction.user.id;
    if (userId !== duel.challenger && userId !== duel.opponent) {
      return interaction.reply({ content: '❌ Tu ne fais pas partie de ce duel !', ephemeral: true });
    }

    if (duel.choices[userId] !== undefined) {
      return interaction.reply({ content: '✅ Tu as déjà fait ton choix, attends ton adversaire.', ephemeral: true });
    }

    duel.choices[userId] = choiceIndex;
    await interaction.reply({ content: `✅ Choix enregistré : ||${choices[choiceIndex]}||`, ephemeral: true });

    // Les deux ont choisi → résultat
    if (duel.choices[duel.challenger] !== undefined && duel.choices[duel.opponent] !== undefined) {
      const c1 = duel.choices[duel.challenger];
      const c2 = duel.choices[duel.opponent];
      const result = getResult(c1, c2);

      let description, color;
      if (result === 'égalité') {
        description = '🤝 Égalité !';
        color = 0xfee75c;
      } else if (result === 'p1') {
        description = `🎉 <@${duel.challenger}> a gagné !`;
        color = 0x57f287;
      } else {
        description = `🎉 <@${duel.opponent}> a gagné !`;
        color = 0x57f287;
      }

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Pierre Feuille Ciseaux — Résultat du duel')
        .addFields(
          { name: `<@${duel.challenger}>`, value: choices[c1], inline: true },
          { name: `<@${duel.opponent}>`, value: choices[c2], inline: true },
        )
        .setDescription(description)
        .setColor(color);

      await interaction.message.edit({ embeds: [embed], components: [] });
      duels.delete(duelId);
    }
  }
});
});

client.login(process.env.TOKEN);
