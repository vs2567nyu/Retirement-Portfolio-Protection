"""Retirement simulation backend.

The package intentionally keeps the canonical Model A engine free of third-party
dependencies. This makes the presentation runnable on a clean Python install;
the HTTP adapter in :mod:`backend.server` uses the standard library as well.

Import public functionality from :mod:`backend.engine`. Keeping package import
side-effect free also allows ``python -m backend.engine`` to run without eagerly
loading the module twice.
"""
