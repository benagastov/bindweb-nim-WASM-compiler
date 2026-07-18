# =============================================================================
# Makefile — thin wrapper over build.sh. All real logic lives in build.sh;
# these targets exist so `make <target>` works for users who expect it.
# =============================================================================

.PHONY: all clang nim nim-docker libs dist serve clean

all:
	./build.sh all

clang:
	./build.sh clang

nim:
	./build.sh nim

nim-docker:
	./build.sh nim-docker

libs:
	./build.sh libs

dist:
	./build.sh dist

serve:
	./build.sh serve

clean:
	./build.sh clean
