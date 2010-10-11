function _setHighlight(ents, alpha)
{
	if (ents.length)
		Engine.GuiInterfaceCall("SetSelectionHighlight", { "entities":ents, "alpha":alpha });
}

function _setStatusBars(ents, enabled)
{
	if (ents.length)
		Engine.GuiInterfaceCall("SetStatusBars", { "entities":ents, "enabled":enabled });
}

function _setMotionOverlay(ents, enabled)
{
	if (ents.length)
		Engine.GuiInterfaceCall("SetMotionDebugOverlay", { "entities":ents, "enabled":enabled });
}

function _playSound(ent)
{
	Engine.GuiInterfaceCall("PlaySound", { "name":"select", "entity":ent });
}

//-------------------------------- -------------------------------- -------------------------------- 
// EntityGroup class for managing grouped entities
// (I've opted for value duplication in member vars for efficiency considering how often selections are made)
//-------------------------------- -------------------------------- -------------------------------- 
function EntityGroup()
{
	// These are used to display the groups
	this.templateNames = []; // List of templateNames
	this.groupCounts = {}; // {unitName : count}
	
	// These are used to create or modify the groups
	this.entIDs = {}; // {entID : unitName}
	this.rankedTemplates = {}; // {ranked unitName : templateName}
	this.groupEntIDs = {}; // {unitName : entIDs of that type}
}

EntityGroup.prototype.reset = function()
{
	this.templateNames = [];
	this.groupCounts = {};
	this.entIDs = {};
	this.rankedTemplates = {};
	this.groupEntIDs = {};
};

EntityGroup.prototype.add = function(entIDs)
{
	for each (var entID in entIDs)
	{
		if (!this.entIDs[entID])
		{
			this.entIDs[entID] = true;
			var entState = GetEntityState(entID);
			var rank = entState.identity.rank;
			var templateName = entState.template;
			var template = GetTemplateData(templateName);
			var unitName = template.name.specific || template.name.generic || "???";

			if (rank)
			{
				if (this.rankedTemplates[unitName])
				{
					this.groupCounts[this.rankedTemplates[unitName]] += 1;
					this.groupEntIDs[unitName].push(entID);
				}
				else
				{
					this.rankedTemplates[unitName] = templateName; // must come before groupCounts
					this.groupCounts[this.rankedTemplates[unitName]] = 1;
					this.groupEntIDs[unitName] = [entID];
					this.templateNames.push(templateName);
				}
			}
			else
			{
				if (this.groupCounts[templateName])
				{
					this.groupCounts[templateName] += 1;
					this.groupEntIDs[unitName].push(entID);
				}
				else
				{
					this.groupCounts[templateName] = 1;
					this.groupEntIDs[unitName] = [entID];
					this.templateNames.push(templateName);
				}
			}
		}
	}
};

EntityGroup.prototype.remove = function(templateName)
{
	delete this.groupCounts[templateName];
};

EntityGroup.prototype.getCount = function(templateName)
{
	if (this.groupCounts[templateName])
		return this.groupCounts[templateName];
	else
		return 0;
};

EntityGroup.prototype.getTemplateNames = function()
{
	return this.templateNames;
};

EntityGroup.prototype.getEntsByUnitName = function(unitName)
{
	return this.groupEntIDs[unitName];
};

// Gets all ents in every group except that unitname
EntityGroup.prototype.getEntsByUnitNameInverse = function(unitName)
{
	var ents = [];

	for (var name in this.groupEntIDs)
		if (name != unitName)
			ents = ents.concat(this.groupEntIDs[name]);	

	return ents;
};


//-------------------------------- -------------------------------- -------------------------------- 
// EntitySelection class for managing the entity selection list and the primary selection
//-------------------------------- -------------------------------- -------------------------------- 
function EntitySelection()
{
	// Private properties:
	//--------------------------------
	this.selected = {}; // { id:id, id:id, ... } for each selected entity ID 'id'

	// { id:id, ... } for mouseover-highlighted entity IDs in these, the key is a string and the value is an int; 
	//	we want to use the int form wherever possible since it's more efficient to send to the simulation code)
	this.highlighted = {}; 

	this.motionDebugOverlay = false;

	// Public properties:
	//--------------------------------
	this.dirty = false; // set whenever the selection has changed
	this.groups = new EntityGroup();
}

// Deselect everything but entities of the chosen type if the modifier is true
// otherwise deselect just the chosen entity
EntitySelection.prototype.makePrimarySelection = function(primaryTemplateName, modifierKey)
{
	var selection = this.toList();
	var entID;
	
	// Find an entID of a unit of the same type
	for (var i = 0; i < selection.length; i++)
	{
		var entState = GetEntityState(selection[i]);
		if (!entState)
			continue;
		if (entState.template == primaryTemplateName)
			entID = selection[i];
	}
	
	var primaryEntState = GetEntityState(entID);
	if (!primaryEntState)
		return;
	var primaryTemplate = GetTemplateData(primaryTemplateName);
	var primaryUnitName = primaryTemplate.name.specific || primaryTemplate.name.generic || "???";

	var ents = [];
	if (modifierKey)
		ents = this.groups.getEntsByUnitNameInverse(primaryUnitName);
	else
		ents = this.groups.getEntsByUnitName(primaryUnitName);

	this.reset();
	this.addList(ents);
	this.groups.add(this.toList()); // Create Selection Groups
}

// Get a list of the template names
EntitySelection.prototype.getTemplateNames = function()
{
	var templateNames = [];
	var ents = this.toList();
	
	for each (var ent in ents)
	{
		var entState = GetEntityState(ent);
		if (entState)
			templateNames.push(entState.template);
	}
	return templateNames;
}

// Update the selection to take care of changes (like units that have been killed)
EntitySelection.prototype.update = function()
{
	var numberRemoved = 0;
	for each (var ent in this.selected)
	{
		var entState = GetEntityState(ent);
		// Remove deleted units
		if (!entState)
		{
			delete this.selected[ent];
			numberRemoved++;
			continue;
		}
		// Remove non-visible units (e.g. moved back into fog-of-war)
		if (entState.visibility == "hidden")
		{
			// Disable any highlighting of the disappeared unit
			_setHighlight([ent], 0);
			_setStatusBars([ent], false);
			_setMotionOverlay([ent], false);

			delete this.selected[ent];
			numberRemoved++;
			continue;
		}
	}
	if (numberRemoved > 0)
	{
		this.dirty = true;
		this.groups.add(this.toList());
	}
};

EntitySelection.prototype.toggle = function(ent)
{
	if (this.selected[ent])
	{
		_setHighlight([ent], 0);
		_setStatusBars([ent], false);
		_setMotionOverlay([ent], false);
		delete this.selected[ent];
	}
	else
	{
		_setHighlight([ent], 1);
		_setStatusBars([ent], true);
		_setMotionOverlay([ent], this.motionDebugOverlay);
		this.selected[ent] = ent;
	}
	this.dirty = true;
};

EntitySelection.prototype.addList = function(ents)
{
	var added = [];
	for each (var ent in ents)
	{
		if (!this.selected[ent])
		{
			added.push(ent);
			this.selected[ent] = ent;
		}
	}
	_setHighlight(added, 1);
	_setStatusBars(added, true);
	_setMotionOverlay(added, this.motionDebugOverlay);
	if (added.length)
		_playSound(added[0]);
	
	this.groups.add(this.toList()); // Create Selection Groups
	this.dirty = true;
};

EntitySelection.prototype.reset = function()
{
	_setHighlight(this.toList(), 0);
	_setStatusBars(this.toList(), false);
	_setMotionOverlay(this.toList(), false);
	this.selected = {};
	this.groups.reset();
	this.dirty = true;
};

EntitySelection.prototype.toList = function()
{
	var ents = [];
	for each (var ent in this.selected)
		ents.push(ent);
	return ents;
};

EntitySelection.prototype.setHighlightList = function(ents)
{
	var highlighted = {};
	for each (var ent in ents)
		highlighted[ent] = ent;

	var removed = [];
	var added = [];

	// Remove highlighting for the old units that are no longer highlighted
	// (excluding ones that are actively selected too)
	for each (var ent in this.highlighted)
		if (!highlighted[ent] && !this.selected[ent])
			removed.push(+ent);
	
	// Add new highlighting for units that aren't already highlighted
	for each (var ent in ents)
		if (!this.highlighted[ent] && !this.selected[ent])
			added.push(+ent);

	_setHighlight(removed, 0);
	_setStatusBars(removed, false);

	_setHighlight(added, 0.5);
	_setStatusBars(added, true);
	
	// Store the new highlight list
	this.highlighted = highlighted;
};

EntitySelection.prototype.SetMotionDebugOverlay = function(enabled)
{
	this.motionDebugOverlay = enabled;
	_setMotionOverlay(this.toList(), enabled);
};

var g_Selection = new EntitySelection();
