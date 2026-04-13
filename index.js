require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [
  new SlashCommandBuilder()
    .setName('pfc')
    .setDescription('Duel Pierre Feuille Ciseaux entre 2 joueurs')
    .addUserOption((option) =>
      option
        .setName('adversaire')
        .setDescription('Le joueur que tu veux defier')
        .setRequired(true),
    )
    .toJSON(),
];

const choices = ['🪨 Pierre', '📄 Feuille', '✂️ Ciseaux'];
const duels = new Map();

function duelResult(p1Choice, p2Choice) {
  if (p1Choice === p2Choice) return 'draw';
  if (
    (p1Choice === 0 && p2Choice === 2) ||
    (p1Choice === 1 && p2Choice === 0) ||
    (p1Choice === 2 && p2Choice === 1)
  ) {
    return 'p1';
  }
  return 'p2';
}

function buildDuelButtons(duelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pfcduel:${duelId}:0`)
      .setLabel('🪨 Pierre')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pfcduel:${duelId}:1`)
      .setLabel('📄 Feuille')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pfcduel:${duelId}:2`)
      .setLabel('✂️ Ciseaux')
      .setStyle(ButtonStyle.Danger),
  );
}

client.once('ready', async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Commande /pfc enregistree.');
  } catch (error) {
    console.error('Erreur enregistrement commandes :', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'pfc') {
    const opponent = interaction.options.getUser('adversaire', true);

    if (opponent.id === interaction.user.id) {
      await interaction.reply({
        content: 'Tu ne peux pas te defier toi-meme.',
        ephemeral: true,
      });
      return;
    }

    if (opponent.bot) {
      await interaction.reply({
        content: 'Choisis un vrai joueur, pas un bot.',
        ephemeral: true,
      });
      return;
    }

    const duelId = interaction.id;
    duels.set(duelId, {
      player1Id: interaction.user.id,
      player2Id: opponent.id,
      picks: {},
      resolved: false,
    });

    const embed = new EmbedBuilder()
      .setTitle('Duel Pierre Feuille Ciseaux')
      .setDescription(
        `${interaction.user} affronte ${opponent}.\nChaque joueur clique sur un bouton. Le choix reste secret.`,
      )
      .setColor(0x5865f2);

    await interaction.reply({
      embeds: [embed],
      components: [buildDuelButtons(duelId)],
    });
    return;
  }

  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('pfcduel:')) return;

  const [prefix, duelId, pickRaw] = interaction.customId.split(':');
  if (prefix !== 'pfcduel') return;

  const pickIndex = Number.parseInt(pickRaw, 10);
  const duel = duels.get(duelId);

  if (!duel) {
    await interaction.reply({
      content: 'Ce duel nest plus actif.',
      ephemeral: true,
    });
    return;
  }

  if (duel.resolved) {
    await interaction.reply({
      content: 'Ce duel est deja termine.',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  if (userId !== duel.player1Id && userId !== duel.player2Id) {
    await interaction.reply({
      content: 'Tu ne fais pas partie de ce duel.',
      ephemeral: true,
    });
    return;
  }

  if (duel.picks[userId] !== undefined) {
    await interaction.reply({
      content: 'Ton choix est deja enregistre, attends lautre joueur.',
      ephemeral: true,
    });
    return;
  }

  duel.picks[userId] = pickIndex;
  await interaction.reply({
    content: `Choix enregistre : ||${choices[pickIndex]}||`,
    ephemeral: true,
  });

  const p1Choice = duel.picks[duel.player1Id];
  const p2Choice = duel.picks[duel.player2Id];
  if (p1Choice === undefined || p2Choice === undefined) return;

  duel.resolved = true;
  const result = duelResult(p1Choice, p2Choice);

  let description = 'Egalite !';
  let color = 0xfee75c;
  if (result === 'p1') {
    description = `<@${duel.player1Id}> gagne !`;
    color = 0x57f287;
  } else if (result === 'p2') {
    description = `<@${duel.player2Id}> gagne !`;
    color = 0x57f287;
  }

  const resultEmbed = new EmbedBuilder()
    .setTitle('Resultat du duel')
    .addFields(
      {
        name: `<@${duel.player1Id}>`,
        value: choices[p1Choice],
        inline: true,
      },
      {
        name: `<@${duel.player2Id}>`,
        value: choices[p2Choice],
        inline: true,
      },
    )
    .setDescription(description)
    .setColor(color);

  await interaction.message.edit({ embeds: [resultEmbed], components: [] });
  duels.delete(duelId);
});

client.login(process.env.TOKEN);
