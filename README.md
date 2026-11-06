# scratch-editor: The Scratch Editor Monorepo

If you'd like to use Scratch, please visit the [Scratch website](https://scratch.mit.edu/). You can build your own
Scratch project by pressing "Create" on that website or by visiting <https://scratch.mit.edu/projects/editor/>.

This is a source code repository for the packages that make up the Scratch editor and a few additional support
packages. Use this if you'd like to learn about how the Scratch editor works or to contribute to its development.

## What's in this repository?

The `packages` directory in this repository contains:

- `scratch-gui` provides the buttons, menus, and other elements that you interact with when creating and editing a
  project. It's also the "glue" that brings most of the other modules together at runtime.
- `scratch-render` draws backdrops, sprites, and clones on the stage.
- `scratch-svg-renderer` processes SVG (vector) images for use with Scratch projects.
- `scratch-vm` is the virtual machine that runs Scratch projects.

_Please add to this list as more packages are migrated to the monorepo._

Each package has its own `README.md` file with more information about that package.

## Tinkibot music

The Sounds category includes `play [NOTE] for [BEATS] beats`,
`rest for [BEATS] beats`, `set tempo to [TEMPO]`, and `change tempo by [TEMPO]`.
Notes use Scratch's piano picker and MIDI numbering (60 is middle C, 69 is A440).
Tempo shares the Scratch project tempo (default 60 BPM, clamped to 20–500 BPM);
durations are clamped to 0–100 beats. Rest and tempo work locally. Play sends
`play_note` with numeric `note` and `duration` in seconds to the claimed robot
and waits for its completion reply. Zero beats is silent and sends no command.
Each note has a request ID echoed by the proxy, and only its matching `OK play`
reply advances the script. Robot errors such as `ERR busy` stop the originating
script and display an error. Note commands complete without reporter bubbles on
the canvas. Update the proxy alongside Tinkiblocks for reliable note sequencing.
Timing helpers live in `packages/scratch-vm/src/extensions/tinkimo_tinkibot/music/`.
The proxy and robot firmware must include music support to play generated notes.

`play drum [DRUM] for [BEATS] beats` offers synthesized Snare Drum (1), Bass Drum
(2), Side Stick (3), Open Hi-Hat (5), Closed Hi-Hat (6), Hand Clap (8), Cowbell
(11) and Triangle (12), using Scratch's drum numbers. Beats use the same project
tempo and 0–100 beat limits as notes. Each hit has its own decay; beats control
the wait before the next block. Zero beats still triggers a drum hit. The robot
is monophonic: the next sound replaces any remaining drum tail. Drum requests use
the same request correlation and error handling as notes, with `OK drum` replies.

## Monorepo migration

### What's going on?

We're migrating the Scratch editor packages into this monorepo. This will allow us to manage all the packages that
make up the Scratch editor in one place, making  it easier to manage dependencies and make changes that affect
multiple packages.

### Why are there only a few packages in this repo?

We're migrating packages in stages. The current plan, which is subject to change, has us migrating repositories in
four batches. We plan to complete the migration within 2025.

### What will happen to the existing repositories?

The existing repositories will be archived and made read-only. Those repositories contain valuable work and
information, including but not limited to issues and pull requests. We plan to keep that information available for
reference, and to selectively migrate it to this new repository.

## Thank you

Scratch would not be what it is today without help from the global community of Scratchers and open-source
contributors. Thank you for your contributions and support. _[Scratch on!](https://scratch.mit.edu/projects/65347738/fullscreen/)_

## Donate

We provide [Scratch](https://scratch.mit.edu) free of charge, and want to keep it that way! Please consider making a
[donation](https://www.scratchfoundation.org/donate) to support our continued engineering, design, community, and
resource development efforts. Donations of any size are appreciated. Thank you!
