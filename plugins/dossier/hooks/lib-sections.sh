#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2034

DS_SEC_ANY='^## '

DS_SEC_GOAL='^## (§G([^A-Za-z]|$)|Goal([[:space:]]|$))'
DS_SEC_CONSTRAINTS='^## (§C([^A-Za-z]|$)|Constraints([[:space:]]|$))'
DS_SEC_INTERFACES='^## (§I([^A-Za-z]|$)|Interfaces([[:space:]]|$))'
DS_SEC_INVARIANTS='^## (§V([^A-Za-z]|$)|Invariants([[:space:]]|$))'
DS_SEC_TASKS='^## (§T([^A-Za-z]|$)|Tasks([[:space:]]|$))'
DS_SEC_BUGS='^## (§B([^A-Za-z]|$)|Bugs([[:space:]]|$))'
DS_SEC_REPOS='^## (§X([^A-Za-z]|$)|Repos([[:space:]]|$))'
DS_SEC_STATUS='^## (§S([^A-Za-z]|$)|Status([[:space:]]|$))'
DS_SEC_CLOSEOUT='^## (§Z([^A-Za-z]|$)|Closeout([[:space:]]|$))'
