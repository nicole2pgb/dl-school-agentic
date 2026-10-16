#!/usr/bin/env node
/** Read-only: prüft, ob der Index für den Namespace "learning-assistant" genutzt werden kann. */
import { checkIndex, getClients, requireKeys } from "./common.js";

requireKeys();
const { pc } = getClients();
checkIndex(pc, { allowExisting: true })
  .then(() => console.log("✓ Prüfung ok (es wurde nichts geschrieben)"))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
