# Lost and Found aplikacija — projekt README

Lost & Found je decentralizirana aplikacija za oglašavanje i pronalazak izgubljenih stvari. Vlasnik objavi što je izgubio i zaključa nagradu u pametnom ugovoru na blockchainu; novac automatski ode nalazniku tek kad vlasnik potvrdi da je stvar stvarno vratio, bez ikakvog posrednika koji uzima proviziju. Sustav je podijeljen na više neovisnih mikroservisa: frontend koji ovaj repozitorij sadrži (povezivanje s MetaMask walletom, objava i pregled oglasa, chat za dogovor primopredaje), storage servis (zaseban repozitorij lost-and-found-back, upravlja slikama i porukama), i sam pametni ugovor.

Projekt je izrađen u sklopu kolegija Raspodijeljeni sustavi i Blockchain aplikacije.

## Live

- App: https://lost-and-found-rs-ba.netlify.app
- Backend repository (contract + storage service): https://github.com/Gabrieln99/lost-and-found-back
- Shared project docs: https://github.com/Gabrieln99/lost-and-found-project

## Tech stack

Vue 3 (Composition API, `<script setup>`), Vite, Pinia, Vue Router, Tailwind CSS v4, ethers.js v6, VeeValidate. Testovi: Vitest + Vue Test Utils. Lint: ESLint + oxlint.

## Stranice

- `/` — naslovna stranica, opis toka objava → prijava → potvrda.
- `/browse` — pregled svih oglasa, filter po statusu i tekstualna pretraga.
- `/listing/:id` — detalji jednog oglasa (slika, status, opis, nagrada, adrese vlasnika/nalaznika, akcije, chat).
- `/create-listing` — forma za objavu novog oglasa.
- `/profile` — vlastiti oglasi i prijave, Sepolia balans, link na povijest transakcija.

## Setup

```bash
npm install
cp .env.example .env.local   # VITE_CONTRACT_ADDRESS, VITE_STORAGE_SERVICE_URL
npm run dev                  # http://localhost:5173
npm run build
npm run test
npm run lint
```

`VITE_STORAGE_SERVICE_URL` — lokalno `http://localhost:8080`, ili deployani servis: https://lost-and-found-storage.onrender.com
`VITE_CONTRACT_ADDRESS` — deployana adresa u `lost-and-found-back/deployments/sepolia.json`.
