# Lost and Found aplikacija — projekt README

Lost & Found je decentralizirana aplikacija za oglašavanje i pronalazak izgubljenih stvari. Vlasnik objavi što je izgubio i zaključa nagradu u pametnom ugovoru na blockchainu; novac automatski ode nalazniku tek kad vlasnik potvrdi da je stvar stvarno vratio, bez ikakvog posrednika koji uzima proviziju. Sustav je podijeljen na više neovisnih mikroservisa: frontend koji ovaj repozitorij sadrži (povezivanje s MetaMask walletom, objava i pregled oglasa, chat za dogovor primopredaje), storage servis (zaseban repozitorij lost-and-found-back, upravlja slikama i porukama), i sam pametni ugovor.

Projekt je izrađen u sklopu kolegija Raspodijeljeni sustavi i Blockchain aplikacije.

## Live

- App: https://lost-and-found-rs-ba.netlify.app
- Backend repository (contract + storage service): https://github.com/Gabrieln99/lost-and-found-back
- Shared project docs: https://github.com/Gabrieln99/lost-and-found-project

## Tech stack

Vue 3 (Composition API, `<script setup>`), Vite, Pinia, Vue Router, Tailwind CSS v4, ethers.js v6, VeeValidate. Tests: Vitest + Vue Test Utils. Lint: ESLint + oxlint.

## Pages

- `/` — landing page introducing the app and the escrow -> report -> confirm flow.
- `/browse` — listing grid with a status filter and text search.
- `/listing/:id` — single-listing detail page: image, status, description, reward, owner/finder addresses, the applicable action buttons, and the message thread.
- `/create-listing` — form to publish a new listing (title, description, location, photo, reward, optional expiration).
- `/profile` — connected wallet's own listings and found reports, plus its Sepolia balance and transaction history link.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in VITE_CONTRACT_ADDRESS, VITE_STORAGE_SERVICE_URL
npm run dev                  # http://localhost:5173
npm run build
npm run test
npm run lint
```

`VITE_STORAGE_SERVICE_URL` should point at a locally running `lost-and-found-back/storage-service` (`http://localhost:8080`) or the deployed one (https://lost-and-found-storage.onrender.com). `VITE_CONTRACT_ADDRESS` is the deployed `LostAndFound` contract on Sepolia — see `lost-and-found-back/deployments/sepolia.json` for the current address.
