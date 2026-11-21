# Neck and head attachment: notes (2026-11-21)

What went wrong on our MPFB bodies, how production characters build the neck, and the rule we keep.
Sources: general rigging practice and the rigs themselves (MPFB2 `game_engine` rig; UE5 Mannequin / MetaHuman,
Daz Genesis 8/9 skeleton layouts as documented by their vendors), standard anatomy (atlanto-occipital joint, cervical
lordosis, SCM / trapezius landmarks). Not re-verified online in this pass: treat the numbers as rules of thumb.

## Anatomy that a silhouette must read
- The head balances on the atlanto-occipital joint, roughly level with the ear canal, a little in front of it. The
  head's pivot (our `Head` joint) belongs there, not at the jaw or the occiput.
- The neck is a cylinder tilted forward ~10-20 deg (cervical lordosis curves it back at the top). Its back line runs
  up into the skull at the occiput, at about the level of the ear lobe; its front line runs down-forward from the
  hyoid to the sternal notch. The jaw and chin are a free edge in front of it, with a throat under the chin
  (cervicomental angle ~105-120 deg).
- Sternocleidomastoid: from behind the ear (mastoid) down and forward to the sternum / clavicle; trapezius: from the
  occiput / nape out and down to the shoulders' tips. Together they make the neck read wider at the base than under
  the jaw, and narrower than the jaw from the front.
- Adult rough sizes: head depth (glabella-opisthocranion) ~195 mm m / ~185 mm f; neck sagittal depth ~110-125 mm m,
  neck breadth ~110-120 mm m; chin-to-sternal-notch ~80-110 mm; neck circumference (ANSUR II, mid-neck) ~395 mm m /
  ~344 mm f median.

## How production rigs do it
- Two neck bones are common (UE5 Mannequin / MetaHuman `neck_01` + `neck_02`; Daz `neckLower` + `neckUpper`):
  the lower one bends at the base of the neck (under the trapezius), the upper one near the skull, so a head turn or a
  posture change spreads over the neck instead of folding one ring of skin. MPFB's `game_engine` rig has ONE neck
  bone (`neck_01`) between the spine and the head.
- Skin weights fade head -> neck over the upper third of the neck and the jaw underside; the occiput and the nape are
  shared by head and the (upper) neck bone, so the back of the neck stays a smooth curve when the head nods.
- Posture is authored by bone rotations in the animation, not by bending the bind pose: the bind pose keeps the
  modelled (natural) neck.

## What happened on ours (bisect: ai/neck/bisect_{m,f}.jpg, measures.json; neck_bisect.py)
- Stock MPFB, our macros, our targets, the scan fit and the neck push all keep a natural, forward-leaning, thick neck
  in the A-pose rest.
- The break came in the T-pose / posture step of build_base.py: the rest pose turned the neck back and the HEAD
  forward by the sum of the spine + neck angles so the gaze stayed level (`-16 / +27` deg, later `-32 / +47`). With one
  neck bone that counter-rotation folds the skin at the head-neck junction: in game the neck became a vertical pole
  under the back of the skull, the head read as a separate piece, and at the larger angles the chin sank into the
  throat. Identity morphs then made it worse: their head deltas were mapped onto the T-posed neck verts by position, so
  the throat took the chin's deltas (fixed in add_identities.mjs: deltas faded by the shipped vertex's head weight and
  by the mapping distance).

## Rule we keep
1. Never counter-rotate the head against the neck in the bind pose. Any rest-pose posture change goes to the spine
   (spine_02 / spine_03) and the NECK takes the opposite turn so the neck's and the head's world angles stay MPFB's.
2. Head-over-shoulders comes from the thorax and the shoulders (clavicles not drawn back), never from bending the neck.
3. Neck fullness goes to the sides and the nape at mid / lower neck; just under the jaw the neck stays a little in.
4. If a stronger upright carriage is ever needed: add a second neck bone (split `neck_01` weights at mid-neck,
   re-target the clips) or author it in the clips; a single-bone bind-pose bend will fold again.
