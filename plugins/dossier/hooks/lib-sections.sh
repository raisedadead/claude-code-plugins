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

# §Z closure keys. A key opens its line: §Z also carries operator prose, and a
# sentence that reaches "...carried into the successor: the age-identity
# exemption" is not a closure. Successor takes the ds:new slug charset
# (skills/new/SKILL.md §1: ^[a-z0-9][a-z0-9-]{0,29}$), optionally date-prefixed,
# and the value ends the token: `successor: auth_2` is not `successor: auth`.
DS_Z_COMPLETE='^[[:space:]]*complete:[[:space:]]+true'
DS_Z_ABANDONED='^[[:space:]]*abandoned:[[:space:]]+true'
DS_Z_SUCCESSOR='^[[:space:]]*successor:[[:space:]]+[a-z0-9][a-z0-9-]*([[:space:]]|$)'
DS_Z_SLUG='^[a-z0-9][a-z0-9-]*$'
