#!/usr/bin/env node
import { buildStatic } from '../src/static-build.mjs';
console.log(JSON.stringify(await buildStatic(),null,2));
