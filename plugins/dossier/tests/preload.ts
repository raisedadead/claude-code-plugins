import { mock } from 'bun:test'
import * as fs from 'node:fs'
import './git_env.ts'
import { fsWithStdio } from './stdio.ts'

void mock.module('node:fs', () => fsWithStdio({ ...fs }))
