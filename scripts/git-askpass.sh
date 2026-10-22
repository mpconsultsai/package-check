#!/bin/sh
case "$1" in
  *[Uu]sername*) printf '%s\n' "x-access-token" ;;
  *) printf '%s\n' "$RELEASE_GITHUB_TOKEN" ;;
esac
