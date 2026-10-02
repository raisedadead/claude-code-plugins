#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2034

DS_SEC_ANY='^## '

DS_SEC_TASKS='^## (§T([^A-Za-z]|$)|Tasks([[:space:]]|$))'
DS_SEC_REPOS='^## (§X([^A-Za-z]|$)|Repos([[:space:]]|$))'
DS_SEC_STATUS='^## (§S([^A-Za-z]|$)|Status([[:space:]]|$))'
