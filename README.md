# NexaScript Discord

Bot Discord officiel pour la gestion des licences NexaLab.

## Fonctionnalités

- Gestion complète des licences (création, modification, suspension, suppression)
- Attribution automatique du rôle client selon le statut de licence
- Commande `/claim` pour que les clients récupèrent leur rôle eux-mêmes
- Logs des actions staff dans un salon dédié
- Statut du bot personnalisable et rotatif
- Support FR / EN
- Interface basée sur les Components V2 de Discord
- Notifications automatiques des nouvelles releases GitHub
- Style de pseudo Discord configurable pour les clients

## Prérequis

- Node.js 20 ou supérieur
- Un bot Discord configuré
- Un token API NexaLab (reseller ou studio)
- L'intent Discord `Server Members Intent` activé

Permissions Discord recommandées :

- `Manage Roles`
- `Change Nickname` (uniquement si `nameStyle.enabled` est activé)
- `Send Messages`
- `View Channels`

Le rôle attribué au bot doit être positionné au-dessus du rôle client dans la hiérarchie des rôles du serveur.

## Installation

```bash
git clone https://github.com/NexaLabFrance/nexascript-discord.git
cd nexascript-discord
npm install
cp config.example.json config.json
```

Renseigner ensuite les paramètres requis dans `config.json` (voir `config.example.json` pour la liste complète des options disponibles).

Déployer les slash commands :

```bash
npm run deploy
```

Démarrer le bot :

```bash
npm start
```
ou
```bash
node src/index.js
```