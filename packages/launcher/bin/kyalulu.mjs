#!/usr/bin/env node
import { main } from '../src/launcher.mjs';
main().catch(error=>{console.error(`Kyalulu: ${error.message}`);process.exitCode=1;});
