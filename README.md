# SahelConnect - Gestion de Vente

Projet complet:
- Frontend: React Native (Expo)
- Backend: Node.js + Express
- Base de donnees: MongoDB
- Fonctionnalite: formulaire de vente + generation de recu PDF

## 1) Structure

- `backend/` API Express + MongoDB + PDFKit
- `frontend/` application mobile React Native

## 2) Lancer MongoDB

Assurez-vous que MongoDB tourne en local sur `mongodb://127.0.0.1:27017`.

## 3) Lancer le backend

```bash
cd backend
npm run dev
```

API disponible sur `http://localhost:5000`

Endpoints:
- `POST /api/auth/login` -> connexion et recuperation d'un token JWT
- `GET /api/sales` -> lister l'historique des ventes
- `GET /api/sales?q=...&from=YYYY-MM-DD&to=YYYY-MM-DD` -> filtrer l'historique
- `POST /api/sales` -> creer une vente
- `PUT /api/sales/:id` -> modifier une vente
- `DELETE /api/sales/:id` -> supprimer une vente
- `GET /api/sales/reports/daily?date=YYYY-MM-DD` -> rapport journalier
- `GET /api/sales/reports/weekly?date=YYYY-MM-DD` -> rapport hebdomadaire
- `GET /api/sales/reports/range?from=YYYY-MM-DD&to=YYYY-MM-DD` -> rapport par intervalle
- `GET /api/sales/reports/daily/export.pdf?date=YYYY-MM-DD` -> exporter rapport journalier en PDF
- `GET /api/sales/reports/weekly/export.pdf?date=YYYY-MM-DD` -> exporter rapport hebdomadaire en PDF
- `GET /api/sales/reports/daily/export.csv?date=YYYY-MM-DD` -> exporter rapport journalier en CSV
- `GET /api/sales/reports/range/export.pdf?from=YYYY-MM-DD&to=YYYY-MM-DD` -> exporter rapport intervalle en PDF
- `GET /api/sales/reports/range/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD` -> exporter rapport intervalle en CSV
- `GET /api/sales/:id/verify` -> verifier l'authenticite du recu
- `GET /api/sales/:id/receipt` -> recuperer le recu PDF

Regle metier:
- Tous les utilisateurs connectes peuvent voir les ventes, rapports et recus.
- Seul l'utilisateur qui a cree une vente peut la modifier/supprimer.

Si vous aviez des ventes anciennes (sans proprietaire), lancez une migration:

```bash
cd backend
npm run migrate:sale-owners
```

Sauvegarde hors ligne (avant deployer):

```bash
cd backend
npm run backup:offline
```

Le backup est cree dans `backend/backups/`.

Restauration depuis un backup:

```bash
cd backend
npm run restore:offline -- backups/sahelconnect-backup-YYYYMMDD-HHMMSS.json
```

Exemple `POST /api/sales`:

```json
{
  "items": [
    { "productName": "Riz", "quantity": 2, "unitPrice": 5000 },
    { "productName": "Huile", "quantity": 1, "unitPrice": 3000 }
  ]
}
```

## 4) Lancer le frontend

```bash
cd frontend
npm start
```

Important:
- Configurez l'URL API mobile via variable Expo:
  - `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:5000` (emulateur Android)
  - `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.87:5000` (telephone local)
  - `EXPO_PUBLIC_API_BASE_URL=https://api.sahelconnect.com` (production)

Exemple PowerShell:

```bash
cd frontend
$env:EXPO_PUBLIC_API_BASE_URL="https://api.sahelconnect.com"
npm start
```

## 5) Flux utilisateur

1. Se connecter avec:
   - Email: `admin@sahelconnect.com`
   - Mot de passe: `Admin@1234`
2. Remplir `nom du produit`, `quantite`, `prix unitaire`
3. Cliquer sur `Enregistrer la vente`
4. Dans l'historique ou l'accueil, cliquer sur `Telecharger` pour enregistrer et envoyer le recu PDF

Le backend enregistre la vente en base et genere le PDF dynamiquement.

## 6) URLs production

Variables backend (production):
- `MONGODB_URI=mongodb+srv://...`
- `JWT_SECRET=<secret-fort>`
- `CORS_ORIGIN=https://ton-frontend.com,https://expo.dev`

Variables frontend (production):
- `EXPO_PUBLIC_API_BASE_URL=https://api.sahelconnect.com`
